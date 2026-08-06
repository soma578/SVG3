#!/usr/bin/env node
/**
 * generate-municipality-viewports.mjs
 *
 * Computes per-municipality viewport (lat, lon, latSpan, lonSpan) from
 * /map/layers/overview/pref/{prefCode}.svg and writes results into
 * /map/regions/{regionId}/municipalities.json.
 *
 * The pref SVGs contain one <path> per municipality with:
 *   data-n03-code="{municipalityCode}"
 *   d="M lon lat L lon lat ..."  (geographic coordinates, x=lon y=lat)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PREF_SVG_DIR = path.join(ROOT, 'map', 'layers', 'overview', 'pref');
const REGIONS_DIR = path.join(ROOT, 'map', 'regions');

const MIN_SPAN = 0.04;   // minimum latSpan / lonSpan in degrees
const PADDING = 0.15;    // 15% padding on each side

// Extract all (lon, lat) coordinate pairs from an SVG path d attribute.
// Handles absolute M/L/C/Q commands (the pref SVGs use only M, L, Z).
function extractCoords(d) {
  const nums = [];
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  let m;
  while ((m = re.exec(d)) !== null) nums.push(Number(m[0]));
  const coords = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const lon = nums[i];
    const lat = nums[i + 1];
    // sanity check: Japan bounding box approx 122-154 lon, 20-46 lat
    if (lon >= 120 && lon <= 156 && lat >= 20 && lat <= 47) {
      coords.push([lon, lat]);
    }
  }
  return coords;
}

// Compute viewport from a list of (lon, lat) pairs.
function computeViewport(allCoords) {
  if (allCoords.length === 0) return null;
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of allCoords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const rawLonSpan = maxLon - minLon;
  const rawLatSpan = maxLat - minLat;
  const lonSpan = Math.max(rawLonSpan * (1 + 2 * PADDING), MIN_SPAN);
  const latSpan = Math.max(rawLatSpan * (1 + 2 * PADDING), MIN_SPAN);
  return {
    lat: Number(centerLat.toFixed(6)),
    lon: Number(centerLon.toFixed(6)),
    latSpan: Number(latSpan.toFixed(6)),
    lonSpan: Number(lonSpan.toFixed(6)),
  };
}

// Parse pref SVG and return a map: n03code → coords[]
function parsePrefSvg(svgPath) {
  const text = fs.readFileSync(svgPath, 'utf8');
  const codeToCoords = new Map();

  // Match <path ... > blocks (paths end with > not />)
  const pathRe = /<path\s([\s\S]*?)>/g;
  let pm;
  while ((pm = pathRe.exec(text)) !== null) {
    const attrs = pm[1];
    if (!attrs.includes('data-n03-code')) continue;
    const codeM = /data-n03-code="([^"]+)"/.exec(attrs);
    const dM = /\bd="([^"]+)"/.exec(attrs);
    if (!codeM || !dM) continue;
    const code = codeM[1];
    const coords = extractCoords(dM[1]);
    if (!codeToCoords.has(code)) codeToCoords.set(code, []);
    codeToCoords.get(code).push(...coords);
  }
  return codeToCoords;
}

const index = JSON.parse(fs.readFileSync(path.join(REGIONS_DIR, 'index.json'), 'utf8'));
const regions = index.regions ?? [];

let totalUpdated = 0;
let totalSkipped = 0;
let totalNoData = 0;

for (const { id: regionId, prefCode } of regions) {
  const muniPath = path.join(REGIONS_DIR, regionId, 'municipalities.json');
  if (!fs.existsSync(muniPath)) { console.warn(`  skip ${regionId}: no municipalities.json`); continue; }
  const svgPath = path.join(PREF_SVG_DIR, `${prefCode}.svg`);
  if (!fs.existsSync(svgPath)) { console.warn(`  skip ${regionId}: no pref SVG ${prefCode}.svg`); continue; }

  const muniData = JSON.parse(fs.readFileSync(muniPath, 'utf8'));
  const codeToCoords = parsePrefSvg(svgPath);

  let changed = false;
  let updatedCount = 0;
  let noDataCount = 0;

  for (const muni of muniData.municipalities ?? []) {
    if (muni.viewport) { totalSkipped++; continue; }  // already set

    // Collect coords for all codes in this municipality
    const allCoords = [];
    for (const code of muni.municipalityCodes ?? []) {
      const coords = codeToCoords.get(code);
      if (coords) allCoords.push(...coords);
    }

    const viewport = computeViewport(allCoords);
    if (!viewport) { noDataCount++; totalNoData++; continue; }

    muni.viewport = viewport;
    changed = true;
    updatedCount++;
    totalUpdated++;
  }

  if (changed) {
    fs.writeFileSync(muniPath, JSON.stringify(muniData, null, 2) + '\n', 'utf8');
  }
  console.log(`  ${regionId} (${prefCode}): updated=${updatedCount} skipped=${totalSkipped - (totalSkipped - updatedCount)} noData=${noDataCount}`);
}

console.log(`\nDone: ${totalUpdated} updated, ${totalSkipped} already had viewport, ${totalNoData} no polygon data found`);
