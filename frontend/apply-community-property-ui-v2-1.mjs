#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const findRepoRoot = (start) => {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'map/webapp/current-map.html')) &&
      fs.existsSync(path.join(current, 'frontend'))
    ) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const repoRoot = findRepoRoot(process.cwd()) || findRepoRoot(here);
if (!repoRoot) throw new Error('SVG3 repo root not found.');

const source = path.join(here, '..', 'map', 'webapp', 'shared', 'communityModalPresentation.js');
const target = path.join(repoRoot, 'map', 'webapp', 'shared', 'communityModalPresentation.js');
const backup = `${target}.pre-v2-1.bak`;

if (!fs.existsSync(source)) throw new Error(`source missing: ${source}`);
if (!fs.existsSync(target)) throw new Error(`target missing: ${target}`);

if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
fs.copyFileSync(source, target);

const result = fs.readFileSync(target, 'utf8');
for (const token of [
  'normalizeNativePropertyMarkup',
  "labels[0] === 'name' && labels[1] === 'value'",
]) {
  if (!result.includes(token)) throw new Error(`verification failed: ${token}`);
}

console.log('[community-property-ui-v2.1] replaced:', target);
console.log('COMMUNITY_PROPERTY_UI_V2_1_OK');
