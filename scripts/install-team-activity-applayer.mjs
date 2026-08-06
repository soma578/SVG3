#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTeamActivityCsvDocuments,
} from '../map/layers/portable/team-activity/teamActivityCsv.js';
import { buildCsvQtctArtifacts } from '../map/publishers/shared/csvQtctPipeline.mjs';

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
await mkdir(path.join(output, 'data'), { recursive: true });
const sourceCsvPath = path.join(workspace, 'map/layers/managed/team-activity-pins/data.csv');
const installedCsv = await readFile(sourceCsvPath, 'utf8');
const regionsIndex = JSON.parse(await readFile(path.join(workspace, 'map/regions/index.json'), 'utf8'));
const regions = regionsIndex.regions || [];
const districtIndexes = new Map();
for (const region of regions) {
  const indexPath = path.join(workspace, 'map/data/districts', region.id, 'district-index.json');
  districtIndexes.set(region.id, JSON.parse(await readFile(indexPath, 'utf8')));
}
const layerConfig = JSON.parse(await readFile(
  path.join(workspace, 'map/layers/managed/team-activity-pins/layer.config.json'), 'utf8',
));
const installedArtifacts = buildCsvQtctArtifacts({
  csvText: installedCsv,
  regions,
  config: layerConfig,
  districtIndexes,
});
if (installedArtifacts.errors.length) throw new Error(installedArtifacts.errors.join(' / '));
const installedDocuments = buildTeamActivityCsvDocuments(installedArtifacts.records);
const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const runtimeColumns = [
  'id', 'title', 'regionId', 'municipalityCode', 'lat', 'lon',
  'status', 'summary', 'description', 'area', 'operator',
];
const runtimeCsv = `${runtimeColumns.join(',')}\n${installedArtifacts.records.map((record) => (
  runtimeColumns.map((column) => csvCell(record[column])).join(',')
)).join('\n')}\n`;
await writeFile(path.join(output, 'source.csv'), installedCsv.endsWith('\n') ? installedCsv : `${installedCsv}\n`);
await writeFile(path.join(output, 'current.csv'), runtimeCsv);
await writeFile(path.join(output, 'data/summary.json'), `${JSON.stringify(installedDocuments.summary)}\n`);
await writeFile(path.join(output, 'data/detail.json'), `${JSON.stringify(installedDocuments.detail)}\n`);
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

// 本体と同じ地区名検索UIを、外部App Layersだけで完結する管理画面へ変換する。
const publisherRuntime = path.join(output, 'runtime', 'publisher');
await mkdir(publisherRuntime, { recursive: true });
for (const file of ['csvQtctPipeline.mjs', 'zipArchive.mjs']) {
  const source = await readFile(path.join(workspace, 'map/publishers/shared', file), 'utf8');
  await writeFile(path.join(publisherRuntime, file), source
    .replaceAll('../../layers/portable/representative-pins/', '../representative-pins/'));
}
const adminAssets = path.join(output, 'admin');
await mkdir(adminAssets, { recursive: true });
await writeFile(path.join(adminAssets, 'regions.json'), `${JSON.stringify(regionsIndex)}\n`);
await writeFile(path.join(adminAssets, 'layer.config.json'), `${JSON.stringify(layerConfig)}\n`);
await writeFile(path.join(adminAssets, 'publisher.config.json'), `${JSON.stringify({
  id: 'team-activity-csv-applayers',
  source: './source.csv',
  publication: './admin/publication.json',
  layerConfig: './admin/layer.config.json',
})}\n`);
await writeFile(path.join(adminAssets, 'publication.json'), `${JSON.stringify({ published: true })}\n`);
const districtIndexOutput = path.join(output, 'district-index');
await mkdir(districtIndexOutput, { recursive: true });
for (const region of regions) {
  await cp(
    path.join(workspace, 'map/data/districts', region.id, 'district-index.json'),
    path.join(districtIndexOutput, `${region.id}.json`),
  );
}
const replaceRequired = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`管理画面変換箇所が見つかりません: ${label}`);
  return source.replace(before, after);
};
let appLayersAdmin = await readFile(path.join(workspace, 'map/publishers/team-activity-csv/admin.html'), 'utf8');
appLayersAdmin = appLayersAdmin
  .replace("'../shared/csvQtctPipeline.mjs'", "'./runtime/publisher/csvQtctPipeline.mjs'")
  .replace("'../shared/zipArchive.mjs'", "'./runtime/publisher/zipArchive.mjs'")
  .replace(
    "import { createZipArchive } from './runtime/publisher/zipArchive.mjs';",
    "import { createZipArchive } from './runtime/publisher/zipArchive.mjs';\n"
      + "    import { buildTeamActivityCsvDocuments } from './teamActivityCsv.js';",
  )
  .replaceAll('mapへ書き出す', 'SVGMap App Layersへ書き出す')
  .replace("fetch(`/data/${regionId}/district-index.json`)", "fetch(`./district-index/${regionId}.json`)")
  .replace("fetch('/map/regions/index.json')", "fetch('./admin/regions.json')")
  .replace("fetch('./publisher.config.json')", "fetch('./admin/publisher.config.json')")
  .replace("href=\"/map/webapp/native-map.html?regionId=okayama\"", "href=\"../../../../svgMapDemo/index-team-csv.html\"");
const packageHelperAnchor = '    const districtIndexes = new Map();';
appLayersAdmin = replaceRequired(appLayersAdmin, packageHelperAnchor, `${packageHelperAnchor}\n`
  + `    const packageBase = 'appLayers/okayamaUniversity/teamActivity/';\n`
  + `    const runtimeColumns = ['id', 'title', 'regionId', 'municipalityCode', 'lat', 'lon', 'status', 'summary', 'description', 'area', 'operator'];\n`
  + `    const packageFiles = () => {\n`
  + `      const documents = buildTeamActivityCsvDocuments(artifacts.records);\n`
  + `      const runtimeCsv = \`${'${runtimeColumns.join(\',\')}'}\\n${'${artifacts.records.map((record) => runtimeColumns.map((column) => csvCell(record[column])).join(\',\')).join(\'\\n\')}'}\\n\`;\n`
  + `      return new Map([\n`
  + `        [\`${'${packageBase}'}source.csv\`, csvText.endsWith('\\n') ? csvText : \`${'${csvText}'}\\n\`],\n`
  + `        [\`${'${packageBase}'}current.csv\`, runtimeCsv],\n`
  + `        [\`${'${packageBase}'}data/summary.json\`, \`${'${JSON.stringify(documents.summary)}'}\\n\`],\n`
  + `        [\`${'${packageBase}'}data/detail.json\`, \`${'${JSON.stringify(documents.detail)}'}\\n\`],\n`
  + `      ]);\n`
  + `    };`, 'package helper');
const writeBlock = `        await writeText(mapRoot, publisherConfig.source.replace(/^\\/map\\//, ''), csvText);
        await writeText(mapRoot, publisherConfig.publication.replace(/^\\/map\\//, ''), \`${'${JSON.stringify({'}
          published: published.checked,
          updatedAt: new Date().toISOString(),
        }, null, 2)}\\n\`);
        for (const [relativePath, content] of artifacts.files) {
          await writeText(mapRoot, relativePath, content);
        }`;
const packageWriteBlock = `        for (const [relativePath, content] of packageFiles()) {
          await writeText(mapRoot, relativePath, content);
        }`;
appLayersAdmin = replaceRequired(appLayersAdmin, writeBlock, packageWriteBlock, 'write package');
const zipBlock = `      const files = new Map(artifacts.files);
      const generatedAt = new Date().toISOString();
      files.set(publisherConfig.source.replace(/^\\/map\\//, ''), csvText.endsWith('\\n') ? csvText : \`${'${csvText}'}\\n\`);
      files.set(publisherConfig.publication.replace(/^\\/map\\//, ''), \`${'${JSON.stringify({'}
        published: published.checked,
        updatedAt: generatedAt,
      }, null, 2)}\\n\`);`;
appLayersAdmin = replaceRequired(appLayersAdmin, zipBlock,
  `      const files = packageFiles();\n      const generatedAt = new Date().toISOString();`, 'zip package');
await writeFile(path.join(output, 'appLayersAdmin.html'), appLayersAdmin);

// 岡山県内は管理画面から別地区を追加しても面表示できるよう、県内全地区を同梱する。
await cp(
  path.join(workspace, 'map/data/districts/okayama/districts-svg'),
  path.join(output, 'districts/okayama'),
  { recursive: true },
);

// こちらで作成したQTCT避難所レイヤーも、同じApp Layers構成へ配置する。
const evacuationOutput = path.join(targetRoot, 'appLayers', 'okayamaUniversity', 'evacuation');
await rm(evacuationOutput, { recursive: true, force: true });
await mkdir(path.join(evacuationOutput, 'runtime'), { recursive: true });
await cp(path.join(workspace, 'map/layers/portable/evacuation'), evacuationOutput, { recursive: true });
await cp(
  path.join(workspace, 'map/layers/portable/representative-pins'),
  path.join(evacuationOutput, 'runtime/representative-pins'),
  { recursive: true },
);
await cp(
  path.join(workspace, 'map/layers/portable/svgmap-slawa-client'),
  path.join(evacuationOutput, 'runtime/svgmap-slawa-client'),
  { recursive: true },
);
const evacuationHtmlPath = path.join(evacuationOutput, 'evacuationLayer.html');
await writeFile(evacuationHtmlPath, (await readFile(evacuationHtmlPath, 'utf8'))
  .replaceAll('../representative-pins/', './runtime/representative-pins/')
  .replaceAll('../svgmap-slawa-client/', './runtime/svgmap-slawa-client/'));
const evacuationProfilePath = path.join(evacuationOutput, 'runtime/representative-pins/pinLayerProfiles.js');
await writeFile(evacuationProfilePath, (await readFile(evacuationProfilePath, 'utf8'))
  .replaceAll('/map/icons/shelter-', 'icons/shelter-'));
await mkdir(path.join(evacuationOutput, 'icons'), { recursive: true });
for (const icon of ['open', 'limited', 'full', 'closed', 'default']) {
  await cp(path.join(workspace, 'map/icons', `shelter-${icon}.png`), path.join(evacuationOutput, 'icons', `shelter-${icon}.png`));
}
await mkdir(path.join(evacuationOutput, 'data'), { recursive: true });
for (const file of ['summary.json', 'density-points.json']) {
  await cp(path.join(workspace, 'map/data/qtct/evacuation', file), path.join(evacuationOutput, 'data', file));
}
await cp(
  path.join(workspace, 'map/data/qtct/evacuation/okayama/detail.json'),
  path.join(evacuationOutput, 'data/detail.json'),
);

const marker = '<!-- okayama-university-team-activity -->';
const entry = `${marker}\n`
  + '<animation x="-30000" y="-30000" width="60000" height="60000" '
  + 'xlink:href="./appLayers/okayamaUniversity/teamActivity/teamActivityLayer.svg#summary=data/summary.json&amp;data=data/detail.json&amp;sourceCsv=current.csv&amp;layer=teamActivity" '
  + 'title="岡山大学 チーム活動（CSV追加対応）" class="防災 poi clickable" visibility="hidden" opacity="1"/>\n'
  + '<animation x="-30000" y="-30000" width="60000" height="60000" '
  + 'xlink:href="./appLayers/okayamaUniversity/teamActivity/teamActivityAreaLayer.svg#data=data/detail.json&amp;districtSvgUrlTemplate=districts/{recordRegionId}/{code}.svg&amp;layer=teamActivity" '
  + 'title="岡山大学 チーム活動エリア" class="防災 vectorEtcData" visibility="hidden" opacity="0.9"/>\n'
  + '<animation x="-30000" y="-30000" width="60000" height="60000" '
  + 'xlink:href="./appLayers/okayamaUniversity/evacuation/evacuationLayer.svg#summary=data/summary.json&amp;data=data/detail.json&amp;layer=evacuation" '
  + 'title="岡山大学 避難所（QTCT・岡山）" class="防災 poi clickable" visibility="hidden" opacity="1"/>\n';
const nextContainer = container.includes(marker)
  ? container.replace(new RegExp(`${marker}[\\s\\S]*?(?=\\n<!--|\\n</svg>)`), entry.trimEnd())
  : container.replace('</svg>', `${entry}\n</svg>`);
await writeFile(containerPath, nextContainer);

await writeFile(path.join(output, 'INSTALLATION.md'), `# 岡山大学 チーム活動レイヤー\n\n`
  + `このディレクトリと Container.svg の登録は専用インストーラーが生成しました。\n\n`
  + `- コントローラーの「CSVを追加」でブラウザ内に活動を追加できます。\n`
  + `- 「SVGMap App Layers管理」で都道府県・市区町村・地区名を検索し、current.csv とQTCTを再生成できます。\n`
  + `- 追加データは既存QTCTへ重ねて描画され、低ズームは密度、高ズームは個別ピンになります。\n`
  + `- 岡山県内の地区境界を同梱しています。県外の面表示には、`
  + '`districts/{regionId}/{municipalityCode}.svg` を追加してください。ピン表示には不要です。\n');

console.log(`[team-activity-applayer] installed: ${output}`);
console.log(`[team-activity-applayer] updated: ${containerPath}`);
