# SVG3 QTCT density points format

Point layers can use the same low/mid/high zoom LOD without adding layer-specific renderer code.

## Files

`summary.json` declares the coordinate artifact relative to itself:

```json
{
  "densityPointsUrl": "density-points.json"
}
```

`density-points.json` uses this schema:

```json
{
  "schemaVersion": 1,
  "layerId": "example",
  "bounds": { "minLon": 122.434, "minLat": 23.546, "maxLon": 154.487, "maxLat": 46.056 },
  "encoding": "u16le-base64",
  "count": 2,
  "data": "..."
}
```

`data` is a base64-encoded byte sequence. Every record is exactly four bytes:

1. longitude as little-endian unsigned 16-bit integer;
2. latitude as little-endian unsigned 16-bit integer.

Both values are relative to `bounds`, where `0` is the minimum and `65535` is the maximum.
Record order has no rendering meaning.

## Rendering contract

- Low and middle zooms quantize all decoded points into a world-aligned 96-pixel QTCT raster.
- Multiple records in one screen pixel collapse naturally into one colored pixel.
- The renderer emits one PNG-backed SVG `image`, not one DOM element per record.
- At `individualZoom`, the layer switches to the ordinary detail QTCT records and clickable pins.
- If the density artifact is absent or invalid, the renderer falls back to `densityGrid` or summary partitions.

The standard `csv-qtct` and `webcam-qtct` generators emit this artifact automatically. A new point layer only needs longitude/latitude records, its normal QTCT build declaration, and an optional pin profile for colors/icons.
