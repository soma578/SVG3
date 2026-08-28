#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'map/webapp/shared/communityModalPresentation.js');
const text = fs.readFileSync(file, 'utf8');

for (const token of [
  'normalizeNativePropertyMarkup',
  "labels[0] === 'name' && labels[1] === 'value'",
  'const normalizedSrc = normalizeNativePropertyMarkup(src);',
]) {
  if (!text.includes(token)) {
    console.error(`MISSING TOKEN: ${token}`);
    process.exit(1);
  }
}
console.log('COMMUNITY_PROPERTY_UI_V2_1_OK');
