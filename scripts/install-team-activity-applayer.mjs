#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!targetRoot) {
  console.error('usage: node scripts/install-team-activity-applayer.mjs /path/to/svgmapAppLayers');
  process.exit(2);
}
const containerPath = path.join(targetRoot, 'Container.svg');
const container = await readFile(containerPath, 'utf8');
if (!container.includes('</svg>')) throw new Error(`SVGMap Container.svgではありません: ${containerPath}`);

const output = path.join(targetRoot, 'appLayers', 'okayamaUniversity', 'teamActivity');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'runtime'), { recursive: true });
await cp(path.join(workspace, 'map/layers/portable/team-activity'), output, { recursive: true });
await cp(
  path.join(workspace, 'map/layers/portable/representative-pins'),
  path.join(output, 'runtime/representative-pins'),
  { recursive: true },
);
await cp(
  path.join(workspace, 'map/layers/portable/svgmap-slawa-client'),
  path.join(output, 'runtime/svgmap-slawa-client'),
  { recursive: true },
);
await cp(path.join(workspace, 'map/data/qtct/teamActivity'), path.join(output, 'data'), { recursive: true });
await cp(path.join(workspace, 'map/layers/managed/team-activity-pins/data.csv'), path.join(output, 'current.csv'));
await mkdir(path.join(output, 'icons'), { recursive: true });
for (const icon of [
  'team-active.png', 'team-standby.png', 'team-planned.png',
  'team-completed.png', 'team-attention.png',
]) {
  await cp(path.join(workspace, 'map/icons', icon), path.join(output, 'icons', icon));
}

for (const htmlName of ['teamActivityLayer.html', 'teamActivityAreaLayer.html']) {
  const htmlPath = path.join(output, htmlName);
  const html = await readFile(htmlPath, 'utf8');
  await writeFile(htmlPath, html
    .replaceAll('../representative-pins/', './runtime/representative-pins/')
    .replaceAll('../svgmap-slawa-client/', './runtime/svgmap-slawa-client/'));
}
const csvModulePath = path.join(output, 'teamActivityCsv.js');
const csvModule = await readFile(csvModulePath, 'utf8');
await writeFile(csvModulePath, csvModule
  .replaceAll('../representative-pins/', './runtime/representative-pins/'));
const profilePath = path.join(output, 'runtime/representative-pins/pinLayerProfiles.js');
const profiles = await readFile(profilePath, 'utf8');
await writeFile(profilePath, profiles.replaceAll('/map/icons/team-', 'icons/team-'));

// 初期CSVで使用する地区だけを同梱する。CSVで追加した地点のピンは全国で動く。
// 面表示も必要な配布者は districts/{regionId}/{municipalityCode}.svg を追加できる。
const collectRecords = (node, records = []) => {
  if (!node) return records;
  if (Array.isArray(node.records)) records.push(...node.records);
  for (const child of node.children || []) collectRecords(child, records);
  return records;
};
const detail = JSON.parse(await readFile(path.join(output, 'data/okayama/detail.json'), 'utf8'));
for (const record of collectRecords(detail.tree)) {
  if (!record.regionId || !record.municipalityCode) continue;
  const source = path.join(
    workspace, 'map/data/districts', record.regionId, 'districts-svg', `${record.municipalityCode}.svg`,
  );
  const destination = path.join(output, 'districts', record.regionId, `${record.municipalityCode}.svg`);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

const marker = '<!-- okayama-university-team-activity -->';
const entry = `${marker}\n`
  + '<animation x="-30000" y="-30000" width="60000" height="60000" '
  + 'xlink:href="./appLayers/okayamaUniversity/teamActivity/teamActivityLayer.svg#summary=data/summary.json&amp;data=data/detail-index.json&amp;sourceCsv=current.csv&amp;layer=teamActivity" '
  + 'title="岡山大学 チーム活動（CSV追加対応）" class="防災 poi clickable" visibility="hidden" opacity="1"/>\n'
  + '<animation x="-30000" y="-30000" width="60000" height="60000" '
  + 'xlink:href="./appLayers/okayamaUniversity/teamActivity/teamActivityAreaLayer.svg#data=data/detail-index.json&amp;districtSvgUrlTemplate=districts/{recordRegionId}/{code}.svg&amp;layer=teamActivity" '
  + 'title="岡山大学 チーム活動エリア" class="防災 vectorEtcData" visibility="hidden" opacity="0.9"/>\n';
const nextContainer = container.includes(marker)
  ? container.replace(new RegExp(`${marker}[\\s\\S]*?(?=\\n<!--|\\n</svg>)`), entry.trimEnd())
  : container.replace('</svg>', `${entry}\n</svg>`);
await writeFile(containerPath, nextContainer);

await writeFile(path.join(output, 'INSTALLATION.md'), `# 岡山大学 チーム活動レイヤー\n\n`
  + `このディレクトリと Container.svg の登録は専用インストーラーが生成しました。\n\n`
  + `- コントローラーの「CSVを追加」でブラウザ内に活動を追加できます。\n`
  + `- 追加データは既存QTCTへ重ねて描画され、低ズームは密度、高ズームは個別ピンになります。\n`
  + `- 初期CSVが参照する地区境界だけを同梱しています。別地域の面表示には、`
  + '`districts/{regionId}/{municipalityCode}.svg` を追加してください。ピン表示には不要です。\n');

console.log(`[team-activity-applayer] installed: ${output}`);
console.log(`[team-activity-applayer] updated: ${containerPath}`);
