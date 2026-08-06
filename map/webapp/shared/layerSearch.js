const collectQtctRecords = (node, records = []) => {
  if (!node) return records;
  if (Array.isArray(node.records)) records.push(...node.records);
  for (const child of node.children || []) collectQtctRecords(child, records);
  return records;
};

const coordinate = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return Number.NaN;
  return Number(value);
};

const featureRecord = (record, layer, search) => ({
  type: record.type || 'feature',
  layerId: record.layerId || search.layerId || layer.id,
  targetLayerId: record.targetLayerId || layer.id,
  layerLabel: record.layerLabel || layer.title || layer.label || layer.id,
  layerGroup: record.layerGroup || layer.group || '',
  symbol: record.symbol || layer.symbol || '',
  id: record.id,
  title: record.title || record.name || record.id,
  subtitle: record.subtitle
    || record.address
    || record.summary
    || record.operator
    || record.properties?.location
    || record.properties?.river
    || layer.title
    || '',
  searchText: record.searchText || [
    record.title,
    record.name,
    record.subtitle,
    record.address,
    record.summary,
    record.description,
    record.area,
    record.operator,
    record.river,
    record.location,
    record.provider,
    record.properties?.location,
    record.properties?.river,
    record.properties?.roadName,
    record.properties?.section,
    layer.title,
  ].filter(Boolean).join(' '),
  lat: coordinate(record.lat),
  lon: coordinate(record.lon),
});

export const normalizeSearchText = (value) => (
  String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g, '')
);

export const createSearchCorpus = ({ regions, municipalities, records }) => [
  ...regions.map((region) => ({
    type: 'region',
    id: region.id,
    title: region.label || region.prefecture || region.id,
    subtitle: '都道府県',
    searchText: `${region.label || ''} ${region.prefecture || ''}`,
  })),
  ...municipalities.map((municipality) => ({
    type: 'municipality',
    id: municipality.id,
    title: municipality.label,
    // どの県の市区町村かを出す。「広島市」と「北広島市(北海道)」が並ぶので、
    // 県名が無いとどちらを選ぶべきか判断できない。
    subtitle: [
      municipality.regionLabel || '市区町村',
      `避難所${municipality.shelterCount || 0}件`,
    ].filter(Boolean).join('・'),
    // 県名でも引けるようにする（「広島 東区」のような入力）。
    searchText: [
      municipality.label || '',
      municipality.displayCode || '',
      municipality.regionLabel || '',
    ].join(' '),
    regionId: municipality.regionId || '',
    municipality,
  })),
  ...records,
].map((candidate) => ({
  ...candidate,
  normalizedTitle: normalizeSearchText(candidate.title),
  normalizedSearchText: normalizeSearchText(candidate.searchText),
}));

// 地名は種別で優先する。地図を動かす目的の検索では、
// 施設名より「県 → 市区町村」が先に出たほうが目的に合う。
const TYPE_RANK = { region: 0, municipality: 1 };
const typeRank = (candidate) => TYPE_RANK[candidate.type] ?? 2;

export const searchCorpus = (corpus, query, limit = 10) => {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return corpus
    .map((candidate) => {
      const score = candidate.normalizedTitle === normalized
        ? 0
        : candidate.normalizedTitle.startsWith(normalized)
          ? 1
          : candidate.normalizedTitle.includes(normalized)
            ? 2
            : candidate.normalizedSearchText.includes(normalized)
              ? 3
              : 99;
      return { ...candidate, score };
    })
    .filter((candidate) => candidate.score < 99)
    .sort((a, b) => (
      a.score - b.score
      // 同じ一致度なら地名を先に。「広島市」で施設名が先頭に来ると地図を動かせない。
      || typeRank(a) - typeRank(b)
      // 短い名前を先に。「広島市」の検索で「東広島市」より「広島市」を上へ。
      || a.title.length - b.title.length
      || a.title.localeCompare(b.title, 'ja')
    ))
    .slice(0, limit);
};

export const createLayerSearchLoader = ({ fetchJson }) => {
  let generation = 0;

  const load = async ({ layers, regionId }) => {
    const currentGeneration = ++generation;
    const requests = new Map();
    const jobs = layers.map(async (layer) => {
      const search = layer.search || {};
      const url = String(search.url || '').replaceAll('{regionId}', encodeURIComponent(regionId));
      if (!url) return [];
      if (!requests.has(url)) requests.set(url, fetchJson(url));
      const data = await requests.get(url);
      if (Array.isArray(data.records)) {
        if (data.schemaVersion !== 1 || (data.layerId && data.layerId !== search.layerId)) {
          throw new Error(`search index schema mismatch: ${url}`);
        }
      }
      const sourceRecords = Array.isArray(data.records) ? data.records : collectQtctRecords(data.tree);
      return sourceRecords
        .map((record) => featureRecord(record, layer, search))
        .filter((record) => Number.isFinite(record.lat) && Number.isFinite(record.lon));
    });
    const results = await Promise.allSettled(jobs);
    if (currentGeneration !== generation) return null;
    return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  };

  const cancel = () => {
    generation += 1;
  };

  return { cancel, load };
};
