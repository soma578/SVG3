#!/usr/bin/env node
/**
 * generate-denshi-containers.mjs
 *
 * Generates per-prefecture denshi container SVGs by SCANNING layer declarations:
 *   /map/containers/Containers_webapp_denshi_{prefCode}.svg
 *
 * Layer sources (docs/SVGmap_official_skill_first.md):
 *   map/layers/managed/<dir>/layer.config.json  ... self-describing managed layers
 *   map/layers/dropins/*.{svg,html}             ... drop-in layers (place a file = it loads)
 *   map/layers/external/.../import.config.json  ... imported external Container.svg animations
 *
 * There is NO hardcoded layer list here. Adding a layer:
 *   - managed: add a directory with layer.config.json
 *   - dropin:  drop the SVG/HTML file into map/layers/dropins/
 * then re-run this script. check-containers.mjs validates output from the SAME scan,
 * so generation and contract cannot drift.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanAllLayers, expandTokens, xmlEscapeAttr, VIEW_BOX } from './lib/scanLayers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CONTAINERS_DIR = path.join(ROOT, 'map', 'containers');
const REGIONS_DIR = path.join(ROOT, 'map', 'regions');
const LAYERS_DIR = path.join(ROOT, 'map', 'layers');
const DISTRICT_PUBLIC_BASE = String(process.env.SVG3_DISTRICT_PUBLIC_BASE || '/data/{regionId}')
  .replace(/\/+$/, '');
if (
  !DISTRICT_PUBLIC_BASE.includes('{regionId}')
  || (!DISTRICT_PUBLIC_BASE.startsWith('/') && !/^https:\/\//.test(DISTRICT_PUBLIC_BASE))
) {
  throw new Error('SVG3_DISTRICT_PUBLIC_BASE must be an absolute path or HTTPS URL containing {regionId}');
}

function writeIfChanged(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== content) {
    fs.writeFileSync(targetPath, content, 'utf8');
    return true;
  }
  return false;
}

const layers = scanAllLayers(ROOT);
if (layers.length === 0) {
  throw new Error('no layers found under map/layers/managed or map/layers/dropins');
}
const seenIds = new Set();
for (const layer of layers) {
  if (seenIds.has(layer.id)) throw new Error(`duplicate layer id: ${layer.id}`);
  seenIds.add(layer.id);
}

function loadLayerPresets() {
  const presetsPath = path.join(LAYERS_DIR, 'presets.config.json');
  if (!fs.existsSync(presetsPath)) return [];
  let config;
  try {
    config = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid JSON in ${presetsPath}: ${error.message}`);
  }
  const presets = Array.isArray(config.presets) ? config.presets : [];
  return presets.map((preset, index) => {
    if (!preset.id) throw new Error(`${presetsPath}: presets[${index}] missing id`);
    if (!preset.label) throw new Error(`${presetsPath}: presets[${index}] missing label`);
    if (!Array.isArray(preset.layers) || preset.layers.length === 0) {
      throw new Error(`${presetsPath}: presets[${index}] must declare layers`);
    }
    return {
      id: preset.id,
      label: preset.label,
      description: preset.description || '',
      layers: preset.layers,
      message: preset.message || `${preset.label}レイヤーを表示しました`,
      alreadyMessage: preset.alreadyMessage || `${preset.label}レイヤーは表示中です`,
    };
  });
}

const ATTR_ORDER = [
  'id',
  'x',
  'y',
  'width',
  'height',
  'xlink:href',
  'title',
  'class',
  'visibility',
  'opacity',
];

function expandedAttrs(layer, tokens) {
  const attrs = { ...(layer.attrs || {}) };
  if (attrs['xlink:href']) attrs['xlink:href'] = expandTokens(attrs['xlink:href'], tokens);
  return attrs;
}

function animationXml(layer, tokens) {
  const attrs = expandedAttrs(layer, tokens);
  const keys = [
    ...ATTR_ORDER.filter((key) => attrs[key] !== undefined),
    ...Object.keys(attrs).filter((key) => !ATTR_ORDER.includes(key)).sort(),
  ];
  const attr = (key) => `${key}="${xmlEscapeAttr(attrs[key])}"`;
  const firstLineKeys = ['id', 'x', 'y', 'width', 'height'].filter((key) => keys.includes(key));
  const restKeys = keys.filter((key) => !firstLineKeys.includes(key) && key !== 'xlink:href');
  const firstLine = firstLineKeys.map(attr).join(' ');
  const hrefLine = attrs['xlink:href'] !== undefined
    ? `\n             ${attr('xlink:href')}`
    : '';
  const restLine = restKeys.length > 0
    ? `\n             ${restKeys.map(attr).join(' ')}`
    : '';
  const comment = layer.comment ? `  <!-- ${layer.comment} -->\n` : '';
  return `${comment}  <animation ${firstLine}${hrefLine}${restLine}/>`;
}

function makeContainer(prefCode, regionId) {
  const tokens = {
    regionId,
    prefCode,
    districtBaseUrl: DISTRICT_PUBLIC_BASE.replaceAll('{regionId}', regionId),
    // 地区境界は「今表示している県」ではなく「その記録が属する県」から引く
    // （全国detailには他県の記録も混ざる）。クライアントが埋める形で渡す。
    districtBaseUrlPattern: DISTRICT_PUBLIC_BASE.replaceAll('{regionId}', '{recordRegionId}'),
  };
  const body = layers.map((layer) => animationXml(layer, tokens)).join('\n\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="${VIEW_BOX}">
  <globalCoordinateSystem srsName="http://purl.org/crs/84" transform="matrix(100,0,0,-100,0,0)" />

${body}
</svg>
`;
}

function makeLayerCatalog() {
  const uiLayers = layers
    .filter((layer) => (
      layer.source.startsWith('external/')
      || layer.source.startsWith('dropins/')
      || layer.ui?.catalog
      || layer.ui?.messages
    ))
    .map((layer) => {
      const kind = layer.ui?.kind || (String(layer.attrs?.class || '').includes('poi') ? 'poi' : layer.source.startsWith('external/') ? 'external' : 'vector');
      const qtctLayer = layer.data?.qtctLayer || layer.build?.qtctLayer || '';
      const search = layer.ui?.search || (
        kind === 'poi' && qtctLayer
          ? {
              kind: 'qtct',
              layerId: qtctLayer,
              url: `/map/data/search/${qtctLayer}/{regionId}.json`,
            }
          : null
      );
      return {
        id: layer.id,
        label: layer.attrs?.title || layer.id,
        visible: layer.attrs?.visibility === 'visible',
        source: layer.source,
        order: layer.order,
        group: layer.ui?.group || (layer.source.startsWith('external/') ? '外部レイヤー' : layer.source.startsWith('dropins/') ? 'dropin' : 'managed'),
        note: layer.ui?.note || (layer.source.startsWith('external/') ? '外部Container由来' : layer.source.startsWith('dropins/') ? 'dropin' : 'managed'),
        kind,
        className: layer.attrs?.class || '',
        symbol: layer.ui?.symbol || '',
        icon: layer.ui?.icon || '',
        accent: layer.ui?.accent || '',
        toggleKey: layer.ui?.toggleKey || layer.id,
        mounts: Array.isArray(layer.ui?.mounts) && layer.ui.mounts.length > 0 ? layer.ui.mounts : [layer.id],
        visibilityStrategy: layer.ui?.visibilityStrategy || 'native',
        search,
        manage: layer.ui?.manage || null,
        controllerUi: layer.ui?.controllerUi || null,
        userToggle: layer.ui?.userToggle !== false,
        messages: layer.ui?.messages ? {
          toHost: Array.isArray(layer.ui.messages.toHost) ? layer.ui.messages.toHost : [],
          fromHost: Array.isArray(layer.ui.messages.fromHost) ? layer.ui.messages.fromHost : [],
        } : null,
        alertFeed: layer.ui?.alertFeed ? {
          url: layer.ui.alertFeed.url || '',
          pollMs: Number(layer.ui.alertFeed.pollMs) || 0,
          staleAfterMinutes: Number(layer.ui.alertFeed.staleAfterMinutes) || 0,
        } : null,
        // 台帳やbuild pipelineの健全性は運用者向けに保持しつつ、
        // 映像自体の鮮度と誤認されるレイヤーではUIへ公開しない。
        health: layer.ui?.showHealth === false ? null : layer.dataSource?.health || null,
        dataSource: layer.dataSource ? {
          ownership: layer.dataSource.ownership || '',
          authority: {
            name: layer.dataSource.authority?.name || '',
            url: layer.dataSource.authority?.url || '',
          },
          delivery: layer.dataSource.delivery || '',
          runtimeFetch: Boolean(layer.dataSource.runtimeFetch),
        } : null,
        disabled: Boolean(layer.ui?.disabled ?? layer.ui?.requiresController),
        requiresController: Boolean(layer.ui?.requiresController),
        experimental: Boolean(layer.ui?.experimental),
        community: layer.ui?.community || null,
      };
    });
  return `${JSON.stringify({ version: 1, layers: uiLayers, presets: loadLayerPresets() }, null, 2)}\n`;
}

const index = JSON.parse(fs.readFileSync(path.join(REGIONS_DIR, 'index.json'), 'utf8'));
const regions = index.regions ?? [];

console.log(`layers (${layers.length}): ${layers.map((l) => `${l.id}[${l.source}]`).join(', ')}`);

let count = 0;
for (const { id: regionId, prefCode } of regions) {
  const content = makeContainer(prefCode, regionId);
  writeIfChanged(path.join(CONTAINERS_DIR, `Containers_webapp_denshi_${prefCode}.svg`), content);
  count++;
}

const catalog = makeLayerCatalog();
writeIfChanged(path.join(LAYERS_DIR, 'catalog.json'), catalog);

console.log(`Done: ${count} container SVGs generated in ${CONTAINERS_DIR}`);
