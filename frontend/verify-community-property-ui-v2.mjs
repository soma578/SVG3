#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const files = {
  adapter: path.join(repoRoot, 'map/webapp/shared/communityPropertyAdapter.js'),
  modal: path.join(repoRoot, 'map/webapp/shared/communityModalPresentation.js'),
  current: path.join(repoRoot, 'map/webapp/current-map.html'),
};

const checks = [
  [files.adapter, "Symbol.for('svg3.communityPropertyContextStack')"],
  [files.adapter, 'propertyHandlerWithContext(func, docId)'],
  [files.modal, 'export const installCommunityModalPresentation'],
  [files.modal, 'if (!context || isAlreadySvg3PropertyMarkup(src))'],
  [files.modal, 'svg3-community-native-property'],
  [files.current, "from './shared/communityModalPresentation.js'"],
  [files.current, 'installCommunityModalPresentation({ svgMap });'],
];

let failed = false;
for (const [file, token] of checks) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING FILE: ${file}`);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(token)) {
    console.error(`MISSING TOKEN: ${token} in ${file}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('COMMUNITY_PROPERTY_UI_V2_OK');
