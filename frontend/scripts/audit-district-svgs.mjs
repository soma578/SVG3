#!/usr/bin/env node
/**
 * audit-district-svgs.mjs
 *
 * Audits which district boundary SVGs exist per municipality,
 * cross-referenced against municipalities.json.
 *
 * District SVGs: /data/{regionId}/districts-svg/{municipalityCode}.svg
 * These are sub-municipality (town/block/district) boundaries.
 * NOT to be confused with /map/layers/overview/pref/{prefCode}.svg (municipality boundaries).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, '..');
const DISTRICT_DATA_DIR = path.join(PROJECT_ROOT, 'map', 'data', 'districts');
const REGIONS_DIR = path.join(PROJECT_ROOT, 'map', 'regions');

// Load the region index to get all regionIds + prefCodes
const indexPath = path.join(REGIONS_DIR, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const regions = index.regions ?? [];

const rows = [];

for (const region of regions) {
  const { id: regionId, prefCode, label } = region;

  // Load municipalities.json
  const muniPath = path.join(REGIONS_DIR, regionId, 'municipalities.json');
  let municipalities = [];
  if (fs.existsSync(muniPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(muniPath, 'utf8'));
      municipalities = data.municipalities ?? [];
    } catch {
      // skip
    }
  }

  // Collect all municipalityCodes expected
  const allExpectedCodes = [];
  for (const muni of municipalities) {
    for (const code of (muni.municipalityCodes ?? [])) {
      allExpectedCodes.push(code);
    }
  }
  const uniqueExpected = [...new Set(allExpectedCodes)];

  // Check which district SVGs exist
  const districtDir = path.join(DISTRICT_DATA_DIR, regionId, 'districts-svg');
  let existingFiles = [];
  if (fs.existsSync(districtDir)) {
    existingFiles = fs.readdirSync(districtDir)
      .filter((f) => f.endsWith('.svg'))
      .sort();
  }
  const existingCodes = new Set(existingFiles.map((f) => f.replace('.svg', '')));

  // Find missing codes
  const missingCodes = uniqueExpected.filter((c) => !existingCodes.has(c));

  // Find extra codes (SVGs that exist but no matching municipality)
  const extraCodes = [...existingCodes].filter((c) => !uniqueExpected.includes(c));

  rows.push({
    regionId,
    prefCode: prefCode ?? '??',
    label,
    municipalityCount: municipalities.length,
    expectedCodeCount: uniqueExpected.length,
    districtSvgCount: existingFiles.length,
    missingCount: missingCodes.length,
    extraCount: extraCodes.length,
    missing: missingCodes.slice(0, 8).join(',') + (missingCodes.length > 8 ? ',...' : ''),
    sample: existingFiles.slice(0, 3).join(','),
  });
}

// Print table
const pad = (s, n) => String(s ?? '').padEnd(n);

console.log('');
console.log(
  pad('regionId', 12) +
  pad('pref', 6) +
  pad('munis', 7) +
  pad('expCodes', 10) +
  pad('svgExists', 10) +
  pad('missing', 8) +
  'missingCodes (first 8)'
);
console.log('-'.repeat(100));

for (const r of rows) {
  const line =
    pad(r.regionId, 12) +
    pad(r.prefCode, 6) +
    pad(r.municipalityCount, 7) +
    pad(r.expectedCodeCount, 10) +
    pad(r.districtSvgCount, 10) +
    pad(r.missingCount, 8) +
    (r.missing || '(none)');
  console.log(line);
}

console.log('');
console.log('=== Summary ===');
const totalExpected = rows.reduce((s, r) => s + r.expectedCodeCount, 0);
const totalExisting = rows.reduce((s, r) => s + r.districtSvgCount, 0);
const totalMissing = rows.reduce((s, r) => s + r.missingCount, 0);
const regionsWithAny = rows.filter((r) => r.districtSvgCount > 0);
const regionsComplete = rows.filter((r) => r.missingCount === 0 && r.districtSvgCount > 0);

console.log(`Regions with any district SVGs : ${regionsWithAny.length} / ${rows.length}`);
console.log(`Regions fully covered          : ${regionsComplete.length} / ${rows.length}`);
console.log(`Total expected codes           : ${totalExpected}`);
console.log(`Total existing SVGs            : ${totalExisting}`);
console.log(`Total missing                  : ${totalMissing}`);
console.log('');

if (regionsWithAny.length > 0) {
  console.log('=== Regions with existing district SVGs ===');
  for (const r of regionsWithAny) {
    console.log(`  ${r.regionId} (${r.prefCode}): ${r.districtSvgCount} SVGs  sample: ${r.sample}`);
  }
}
