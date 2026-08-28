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
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const repoRoot =
  findRepoRoot(process.cwd()) ||
  findRepoRoot(here);

if (!repoRoot) {
  throw new Error('SVG3 repo root not found (expected map/webapp/current-map.html and frontend/).');
}

const currentMapPath = path.join(repoRoot, 'map/webapp/current-map.html');
const backupPath = `${currentMapPath}.pre-community-property-preserve-v1.bak`;

let text = fs.readFileSync(currentMapPath, 'utf8');
const originalText = text;

if (!text.includes('installCommunityPropertyRegistrationMonitor')) {
  const importPattern = /import\s*\{\s*communityPropertyTransformForLayer,\s*registerCommunityPropertyAdapter,\s*\}\s*from\s*['"]\.\/shared\/communityPropertyAdapter\.js['"];/m;

  if (!importPattern.test(text)) {
    throw new Error('communityPropertyAdapter import block not found; current-map.html may have diverged.');
  }

  text = text.replace(
    importPattern,
    `import {
      communityPropertyTransformForLayer,
      installCommunityPropertyRegistrationMonitor,
      registerCommunityPropertyAdapter,
    } from './shared/communityPropertyAdapter.js';`,
  );
}

if (!text.includes('installCommunityPropertyRegistrationMonitor(svgMap);')) {
  const assignmentPattern = /(\bsvgMap\s*=\s*svgMapModule\.svgMap;\s*\n\s*window\.svgMap\s*=\s*svgMap;\s*)/m;

  if (!assignmentPattern.test(text)) {
    throw new Error('svgMap assignment block not found; current-map.html may have diverged.');
  }

  text = text.replace(
    assignmentPattern,
    `$1
      // Observe property-handler registrations before any community controller
      // can register its own setShowPoiProperty callback. SVG3 generic UI is a
      // fallback only and must never overwrite a controller/native handler.
      installCommunityPropertyRegistrationMonitor(svgMap);
`,
  );
}

const oldComment = `      // Root animationのiid確定と、上流controller側の独自handler登録の後にも
      // 実行し、追加レイヤーのプロパティ表示だけをホスト共通形式へ統一する。`;
const newComment = `      // Root animationのiid確定タイミングに合わせてfallback登録を再試行する。
      // Community controller自身がsetShowPoiProperty()を登録した場合は
      // registration monitorが検知し、SVG3 generic adapterでは上書きしない。`;

if (text.includes(oldComment)) {
  text = text.replace(oldComment, newComment);
}

if (text === originalText) {
  console.log('[community-property-preserve] current-map.html already patched');
} else {
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(currentMapPath, backupPath);
    console.log(`[community-property-preserve] backup: ${backupPath}`);
  }
  fs.writeFileSync(currentMapPath, text, 'utf8');
  console.log(`[community-property-preserve] patched: ${currentMapPath}`);
}

const required = [
  'installCommunityPropertyRegistrationMonitor,',
  'installCommunityPropertyRegistrationMonitor(svgMap);',
  'registerCommunityPropertyAdapter',
];

const finalText = fs.readFileSync(currentMapPath, 'utf8');
for (const token of required) {
  if (!finalText.includes(token)) {
    throw new Error(`verification failed: missing ${token}`);
  }
}

console.log('[community-property-preserve] OK');
console.log('[community-property-preserve] next: cd frontend && npm run assets:prepare -- --path webapp');
