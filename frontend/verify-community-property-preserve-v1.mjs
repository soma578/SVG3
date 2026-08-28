#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const adapter = path.join(repoRoot, 'map/webapp/shared/communityPropertyAdapter.js');
const currentMap = path.join(repoRoot, 'map/webapp/current-map.html');

const checks = [
  [adapter, 'export const installCommunityPropertyRegistrationMonitor'],
  [adapter, "owner !== 'svg3-fallback'"],
  [adapter, 'if (hasNativePropertyRegistration(svgMap, id)) return false;'],
  [currentMap, 'installCommunityPropertyRegistrationMonitor,'],
  [currentMap, 'installCommunityPropertyRegistrationMonitor(svgMap);'],
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

console.log('COMMUNITY_PROPERTY_PRESERVE_OK');
