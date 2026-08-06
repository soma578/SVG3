#!/usr/bin/env node
/**
 * update-runtime-configs.mjs
 *
 * Updates all 47 prefecture runtime-config.json files:
 *  - containerUrl → Containers_webapp_denshi_{prefCode}.svg
 *  - layers.baseArea.layerUrl → /map/layers/overview/pref/{prefCode}.svg
 *  - layers.evacuation.dataUrl → /map/data/evacuation/{regionId}.json
 *  - layers.teamActivity.dataUrl → /map/data/team-activity/{regionId}.json
 *  - layers.teamActivity.baseAreaLayerUrl → /map/layers/overview/pref/{prefCode}.svg
 *  - layers.teamActivity.districtSvgUrlTemplate → /data/{regionId}/districts-svg/{code}.svg
 *  - bumps version
 *
 * Pass region IDs to limit scope:
 *   node update-runtime-configs.mjs okayama ehime hokkaido
 * Or no args to update all 47.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REGIONS_DIR = path.join(ROOT, 'map', 'regions');

const index = JSON.parse(fs.readFileSync(path.join(REGIONS_DIR, 'index.json'), 'utf8'));
const allRegions = index.regions ?? [];

const targetIds = process.argv.slice(2);
const regions = targetIds.length > 0
  ? allRegions.filter((r) => targetIds.includes(r.id))
  : allRegions;

if (regions.length === 0) {
  console.error('No matching regions found. Check the region IDs.');
  process.exit(1);
}

console.log(`Updating ${regions.length} region(s)...`);

for (const { id: regionId, prefCode, label } of regions) {
  const cfgPath = path.join(REGIONS_DIR, regionId, 'runtime-config.json');
  if (!fs.existsSync(cfgPath)) {
    console.warn(`  skip ${regionId}: no runtime-config.json`);
    continue;
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // Bump version
  const currentVersion = Number(cfg.version) || 0;
  cfg.version = String(currentVersion + 1);

  // Ensure prefCode is present
  if (!cfg.prefCode) cfg.prefCode = prefCode;

  // Container URL
  cfg.containerUrl = `/map/containers/Containers_webapp_denshi_${prefCode}.svg`;

  // Ensure layers object exists
  cfg.layers = cfg.layers || {};

  // baseArea
  cfg.layers.baseArea = {
    ...(cfg.layers.baseArea || {}),
    layerUrl: `/map/layers/overview/pref/${prefCode}.svg`,
    runtimeVisible: true,
    opacity: 1,
  };

  // evacuation
  cfg.layers.evacuation = {
    ...(cfg.layers.evacuation || {}),
    dataUrl: `/map/data/evacuation/${regionId}.json`,
    runtimeVisible: true,
    opacity: 1,
  };

  // teamActivity
  cfg.layers.teamActivity = {
    ...(cfg.layers.teamActivity || {}),
    dataUrl: `/map/data/team-activity/${regionId}.json`,
    baseAreaLayerUrl: `/map/layers/overview/pref/${prefCode}.svg`,
    districtSvgUrlTemplate: `/data/${regionId}/districts-svg/{code}.svg`,
    runtimeVisible: true,
    opacity: 1,
  };

  // interaction (ensure defaults)
  cfg.interaction = cfg.interaction || { disableDefaultPopup: true, featureSelectEvent: true };

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`  updated ${regionId} (${prefCode}) ${label} → v${cfg.version}`);
}

console.log('\nDone.');
