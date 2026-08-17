import { makeQtctDocument } from '../representative-pins/qtctBuilder.mjs';

export const TEAM_ACTIVITY_CSV_STORAGE_KEY = 'svgmap:team-activity:csv:v1';
export const TEAM_ACTIVITY_CSV_CHANNEL = 'svgmap-team-activity-csv';
export const TEAM_ACTIVITY_CSV_COLUMNS = [
  'id', 'title', 'regionId', 'municipalityCode', 'lat', 'lon',
  'status', 'summary', 'description', 'area', 'operator',
];
export const TEAM_ACTIVITY_CSV_REQUIRED_VALUES = ['id', 'title', 'regionId', 'lat', 'lon'];

export const TEAM_ACTIVITY_CSV_TEMPLATE = `${TEAM_ACTIVITY_CSV_COLUMNS.join(',')}\n`
  + 'sample-001,給水支援チーム,okayama,33101,34.668,133.928,active,給水支援を実施中,活動内容の説明,岡山市北区,支援本部\n';

export const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((columns) => columns.some((value) => String(value).trim()));
};

export const parseTeamActivityCsv = (text) => {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { records: [], errors: ['CSVが空です'] };
  const headers = rows[0].map((value) => String(value).trim());
  const errors = TEAM_ACTIVITY_CSV_COLUMNS.filter((column) => !headers.includes(column))
    .map((column) => `必須列がありません: ${column}`);
  const records = [];
  rows.slice(1).forEach((values, rowIndex) => {
    const line = rowIndex + 2;
    const row = Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()]));
    for (const column of TEAM_ACTIVITY_CSV_REQUIRED_VALUES) {
      if (!row[column]) errors.push(`${line}行目: ${column}が空です`);
    }
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      errors.push(`${line}行目: lat/lonが数値ではありません`);
      return;
    }
    if (TEAM_ACTIVITY_CSV_REQUIRED_VALUES.some((column) => !row[column])) return;
    records.push({
      id: `csv:${row.id}`, sourceId: row.id, title: row.title,
      layerId: 'teamActivity', kind: 'activity-marker', regionId: row.regionId,
      municipalityCode: row.municipalityCode, lat, lon, status: row.status || 'active',
      summary: row.summary, description: row.description, area: row.area, operator: row.operator,
      properties: { source: 'local-csv', sourceId: row.id },
    });
  });
  const ids = records.map((record) => record.id);
  for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) {
    errors.push(`idが重複しています: ${id.replace(/^csv:/, '')}`);
  }
  return { records: errors.length ? [] : records, errors };
};

export const buildTeamActivityCsvDocuments = (records) => {
  const summary = makeQtctDocument({
    layerId: 'teamActivity', regionId: 'all', label: 'CSV追加チーム活動', records, summary: true,
  });
  const detail = makeQtctDocument({
    layerId: 'teamActivity', regionId: 'all', label: 'CSV追加チーム活動', records,
  });
  if (summary.tree) summary.tree.densityPoints = records.flatMap((record) => [record.lon, record.lat]);
  return { summary, detail };
};
