#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path("/home/ubuntu/SVG2")
SOURCE = ROOT / "frontend/public/okayama_landslide.geojson"
OUTPUT = ROOT / "map/layers/hazard_landslide_okayama.svg"

VIEWBOX = (13356.86, -3486.06, 41.83, 51.06)


def iter_rings(geometry: dict) -> list[list[list[float]]]:
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if geom_type == "Polygon":
        return coords
    if geom_type == "MultiPolygon":
        rings: list[list[list[float]]] = []
        for polygon in coords:
            rings.extend(polygon)
        return rings
    return []


def sample_ring(ring: list[list[float]]) -> list[list[float]]:
    if len(ring) <= 24:
      return ring
    step = 1
    if len(ring) > 240:
        step = 4
    elif len(ring) > 120:
        step = 3
    elif len(ring) > 60:
        step = 2

    sampled = ring[::step]
    if sampled[0] != ring[0]:
        sampled.insert(0, ring[0])
    if sampled[-1] != ring[-1]:
        sampled.append(ring[-1])
    return sampled


def to_root_point(point: list[float]) -> tuple[float, float]:
    lon, lat, *_rest = point
    return lon * 100.0, -lat * 100.0


def perpendicular_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    if start == end:
        return math.dist(point, start)

    px, py = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1)
    denominator = math.hypot(y2 - y1, x2 - x1)
    return numerator / denominator


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points

    start = points[0]
    end = points[-1]
    max_distance = 0.0
    max_index = 0

    for idx in range(1, len(points) - 1):
        distance = perpendicular_distance(points[idx], start, end)
        if distance > max_distance:
            max_distance = distance
            max_index = idx

    if max_distance <= epsilon:
        return [start, end]

    left = rdp(points[: max_index + 1], epsilon)
    right = rdp(points[max_index:], epsilon)
    return left[:-1] + right


def simplify_ring(ring: list[list[float]]) -> list[tuple[float, float]]:
    sampled = sample_ring(ring)
    if len(sampled) < 4:
        return []

    points = [to_root_point(point) for point in sampled]
    if points[0] != points[-1]:
        points.append(points[0])

    epsilon = 0.035
    if len(points) > 240:
        epsilon = 0.05
    elif len(points) > 120:
        epsilon = 0.04

    simplified = rdp(points[:-1], epsilon)
    if len(simplified) < 3:
        return []
    simplified.append(simplified[0])
    return simplified


def to_path(ring: list[list[float]]) -> str:
    simplified = simplify_ring(ring)
    if len(simplified) < 4:
        return ""

    points: list[str] = []
    for x, y in simplified:
        points.append(f"{x:.2f} {y:.2f}")
    return "M " + " L ".join(points) + " Z"


def main() -> None:
    geojson = json.loads(SOURCE.read_text(encoding="utf-8"))

    warning_paths: list[str] = []
    special_paths: list[str] = []

    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        level = props.get("A33_002")
        for ring in iter_rings(feature.get("geometry", {})):
            path_d = to_path(ring)
            if not path_d:
                continue
            if level == 2:
                special_paths.append(path_d)
            else:
                warning_paths.append(path_d)

    min_x, min_y, width, height = VIEWBOX
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x} {min_y} {width} {height}">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100.0,0,0,-100.0,0,0)" />

  <defs>
    <pattern id="landslide-warning-hatch" patternUnits="userSpaceOnUse" width="2.6" height="2.6" patternTransform="rotate(35)">
      <rect width="2.6" height="2.6" fill="#fb923c" fill-opacity="0.16" />
      <line x1="0" y1="0" x2="0" y2="2.6" stroke="#c2410c" stroke-width="0.42" opacity="0.55" />
    </pattern>
    <pattern id="landslide-special-hatch" patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(35)">
      <rect width="2.2" height="2.2" fill="#ef4444" fill-opacity="0.18" />
      <line x1="0" y1="0" x2="0" y2="2.2" stroke="#991b1b" stroke-width="0.45" opacity="0.65" />
    </pattern>
  </defs>

  <g id="landslide-warning" fill="url(#landslide-warning-hatch)" stroke="#c2410c" stroke-width="0.08" opacity="0.95">
    <path d="{' '.join(warning_paths)}" />
  </g>
  <g id="landslide-special" fill="url(#landslide-special-hatch)" stroke="#991b1b" stroke-width="0.1" opacity="0.98">
    <path d="{' '.join(special_paths)}" />
  </g>
</svg>
"""

    OUTPUT.write_text(svg, encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    print(f"warning paths: {len(warning_paths)}")
    print(f"special paths: {len(special_paths)}")


if __name__ == "__main__":
    main()
