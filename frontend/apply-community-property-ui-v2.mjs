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
      fs.existsSync(path.join(current, 'map/webapp/shared/communityPropertyAdapter.js')) &&
      fs.existsSync(path.join(current, 'frontend'))
    ) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const repoRoot = findRepoRoot(process.cwd()) || findRepoRoot(here);
if (!repoRoot) throw new Error('SVG3 repo root not found.');

const currentMapPath = path.join(repoRoot, 'map/webapp/current-map.html');
const backupPath = `${currentMapPath}.pre-community-property-ui-v2.bak`;
let text = fs.readFileSync(currentMapPath, 'utf8');
const original = text;

if (!text.includes('installCommunityPropertyRegistrationMonitor')) {
  throw new Error(
    'community property preservation v1 is not applied. Apply v1 before v2.',
  );
}

if (!text.includes("from './shared/communityModalPresentation.js'")) {
  const anchor = "import { fetchWithRuntimeCache } from './shared/runtimeCache.js';";
  if (!text.includes(anchor)) {
    throw new Error('runtimeCache import anchor not found.');
  }
  text = text.replace(
    anchor,
    `${anchor}
    import { installCommunityModalPresentation } from './shared/communityModalPresentation.js';`,
  );
}

if (!text.includes('installCommunityModalPresentation({ svgMap });')) {
  const anchor = 'installCommunityPropertyRegistrationMonitor(svgMap);';
  if (!text.includes(anchor)) {
    throw new Error('property registration monitor installation not found.');
  }
  text = text.replace(
    anchor,
    `${anchor}
      // Preserve each layer's property semantics while presenting property
      // modals in the SVG3 shell. Tool/controller modals outside property
      // callbacks are intentionally left untouched.
      installCommunityModalPresentation({ svgMap });`,
  );
}

if (text !== original) {
  if (!fs.existsSync(backupPath)) fs.copyFileSync(currentMapPath, backupPath);
  fs.writeFileSync(currentMapPath, text, 'utf8');
  console.log(`[community-property-ui-v2] patched: ${currentMapPath}`);
} else {
  console.log('[community-property-ui-v2] current-map.html already patched');
}

const finalText = fs.readFileSync(currentMapPath, 'utf8');
for (const token of [
  "installCommunityModalPresentation } from './shared/communityModalPresentation.js'",
  'installCommunityModalPresentation({ svgMap });',
]) {
  if (!finalText.includes(token)) throw new Error(`verification failed: ${token}`);
}

console.log('[community-property-ui-v2] OK');
console.log('[community-property-ui-v2] next: cd frontend && npm run assets:prepare -- --path webapp');
