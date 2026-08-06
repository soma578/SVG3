import { MAP_MESSAGES } from './shared/mapMessages.js';
import { parseMapUrlState, serializeMapUrlState } from './shared/mapUrlState.js';
import {
  importBundledCommunityLayer,
  importContainerText,
  importLocalLayerFile,
  importSingleLayer,
  loadImportedLayers,
  saveImportedLayers,
} from './shared/nativeLayerImporter.js';
import { fetchVerifiedArtifactContainer } from './shared/artifactIndex.js';
import { createArtifactBrowser } from './shared/artifactBrowser.js';
import { loadLayerCatalog } from './shared/layerCatalog.js';
import { createLayerAlertPoller } from './shared/layerAlertPoller.js';
import {
  loadLayerHealthData,
} from './shared/layerHealth.js';
import {
  createLayerSearchLoader,
  createSearchCorpus,
  searchCorpus,
} from './shared/layerSearch.js';
import { createLayerPanel } from './shared/layerPanel.js';
import { createRegionSelector } from './shared/regionSelector.js';
import { dataFreshnessView, normalizeDataStatus } from './shared/dataFreshness.js';
import {
  cacheRegion,
  listCachedRegions,
  onCacheEvent,
  registerServiceWorker,
  removeRegion,
  serviceWorkerSupported,
} from './shared/swClient.js';
import { cacheOutcomeMessage, offlineRegionRows } from './shared/offlineStorageView.js';

const elements = {
  frame: document.getElementById('map-frame'),
  region: document.getElementById('region-select'),
  municipality: document.getElementById('municipality-select'),
  layerPanel: document.getElementById('layer-panel'),
  layerButton: document.getElementById('layer-button'),
  appMenuButton: document.getElementById('app-menu-button'),
  appMenu: document.getElementById('app-menu'),
  menuImportLayer: document.getElementById('menu-import-layer'),
  menuImportArtifact: document.getElementById('menu-import-artifact'),
  teamActivityPublisherLink: document.getElementById('team-activity-publisher-link'),
  panelClose: document.getElementById('panel-close'),
  importButton: document.getElementById('layer-import-button'),
  importForm: document.getElementById('layer-import-form'),
  importKind: document.getElementById('layer-import-kind'),
  importIndexUrl: document.getElementById('layer-import-index-url'),
  importIndexActions: document.getElementById('layer-import-index-actions'),
  importIndexLoad: document.getElementById('layer-import-index-load'),
  importArtifact: document.getElementById('layer-import-artifact'),
  importArtifactMeta: document.getElementById('layer-import-artifact-meta'),
  artifactPublisher: document.getElementById('artifact-publisher'),
  artifactLicense: document.getElementById('artifact-license'),
  artifactRelease: document.getElementById('artifact-release'),
  artifactDownload: document.getElementById('layer-download'),
  artifactDescription: document.getElementById('artifact-description'),
  artifactActionHelp: document.getElementById('artifact-action-help'),
  importUrl: document.getElementById('layer-import-url'),
  importFile: document.getElementById('layer-import-file'),
  importTitle: document.getElementById('layer-import-title'),
  importSubmit: document.getElementById('layer-import-submit'),
  importStatus: document.getElementById('layer-import-status'),
  communityCompatibility: document.getElementById('community-compatibility'),
  communityCompatibilitySummary: document.getElementById('community-compatibility-summary'),
  communityCompatibilityList: document.getElementById('community-compatibility-list'),
  communityCatalogSearch: document.getElementById('community-catalog-search'),
  communityCatalogStatus: document.getElementById('community-catalog-status'),
  layerPresets: document.getElementById('layer-presets'),
  layerList: document.getElementById('layer-list'),
  layerCount: document.getElementById('layer-count'),
  readyDot: document.getElementById('ready-dot'),
  status: document.getElementById('status-text'),
  loading: document.getElementById('loading'),
  search: document.getElementById('map-search'),
  searchClear: document.getElementById('search-clear'),
  searchResults: document.getElementById('search-results'),
  searchResultList: document.getElementById('search-result-list'),
  searchEmpty: document.getElementById('search-empty'),
  alertStack: document.getElementById('alert-stack'),
  dataStatusBar: document.getElementById('data-status-bar'),
  offlineSaveRegion: document.getElementById('offline-save-region'),
  offlineStorageStatus: document.getElementById('offline-storage-status'),
  offlineRegionList: document.getElementById('offline-region-list'),
  offlineStorageEmpty: document.getElementById('offline-storage-empty'),
};

const params = new URLSearchParams(location.search);
const initialUrlState = parseMapUrlState(location.hash);
let mapSessionCounter = 0;
const state = {
  regions: [],
  municipalities: [],
  allMunicipalities: [],
  regionId: params.get('regionId') || '',
  municipalityId: params.get('municipalityId') || '',
  municipality: null,
  runtimeConfig: null,
  layers: [],
  presets: [],
  searchLayers: [],
  importedLayers: loadImportedLayers(),
  artifacts: [],
  communityCatalog: null,
  artifactIndexUrl: '',
  artifactIndexExternal: false,
  searchRecords: [],
  searchCorpus: [],
  runtimeReady: false,
  mapSession: '',
  acceptViewportUpdates: false,
  viewport: initialUrlState.viewport,
  visibleLayerIds: initialUrlState.visibleLayerIds
    ? new Set(initialUrlState.visibleLayerIds)
    : null,
  layerStates: initialUrlState.layerStates,
  alertSummaries: new Map(),
  dismissedAlerts: new Set(),
  // key -> { key, label, source, cachedAt, message, at }。source が 'network' 以外の
  // エントリが1件でもあれば鮮度バナーを出す。閉じる手段は意図的に持たせない。
  dataStatus: new Map(),
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};

const postToMap = (message) => {
  elements.frame.contentWindow?.postMessage(message, location.origin);
};

const syncMapUiInsets = () => {
  const panelOpen = elements.layerPanel.classList.contains('open');
  postToMap({
    type: MAP_MESSAGES.mapSetUiInsets,
    right: panelOpen && innerWidth > 820 ? 428 : 0,
  });
};

const setLayerPanelOpen = (open) => {
  elements.layerPanel.classList.toggle('open', open);
  elements.layerButton.classList.toggle('active', open);
  elements.layerButton.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('panel-open', open);
  syncMapUiInsets();
};

let restoreLayerPanelAfterController = false;

const openLayerController = (layer) => {
  if (!layer?.controllerUi) return;
  restoreLayerPanelAfterController = elements.layerPanel.classList.contains('open');
  setLayerPanelOpen(false);
  postToMap({ type: MAP_MESSAGES.mapOpenLayerUi, layerId: layer.id });
};

const setAppMenuOpen = (open) => {
  if (open) setLayerPanelOpen(false);
  elements.appMenu.hidden = !open;
  elements.appMenuButton.classList.toggle('active', open);
  elements.appMenuButton.setAttribute('aria-expanded', String(open));
};

const updatePublisherLink = () => {
  const target = new URL('/map/publishers/team-activity-csv/admin.html', location.href);
  target.searchParams.set('return', `${location.pathname}${location.search}`);
  elements.teamActivityPublisherLink.href = target.href;
};

const openImportFromMenu = (kind) => {
  setAppMenuOpen(false);
  setLayerPanelOpen(true);
  elements.importKind.value = kind;
  setImportKindFields();
  setImportFormOpen(true);
};

const setImportFormOpen = (open) => {
  elements.importForm.hidden = !open;
  elements.importButton.classList.toggle('active', open);
  if (open) {
    setLayerPanelOpen(true);
    if (elements.importKind.value === 'artifact') {
      void loadLocalArtifactIndex().then(() => elements.importArtifact.focus());
    } else {
      elements.importUrl.focus();
    }
  }
};

const setStatus = (message, ready = false) => {
  elements.status.textContent = message;
  elements.readyDot.classList.toggle('ready', ready);
};

let updateUrlTimer = null;
const updateUrl = () => {
  const next = new URL(location.href);
  next.searchParams.set('regionId', state.regionId);
  if (state.municipalityId) next.searchParams.set('municipalityId', state.municipalityId);
  else next.searchParams.delete('municipalityId');
  next.hash = serializeMapUrlState({
    viewport: state.viewport,
    visibleLayerIds: state.visibleLayerIds ? [...state.visibleLayerIds] : [],
    layerStates: state.layerStates,
  });
  history.replaceState(null, '', next);
  updatePublisherLink();
};
const scheduleUrlUpdate = () => {
  if (updateUrlTimer) window.clearTimeout(updateUrlTimer);
  updateUrlTimer = window.setTimeout(() => {
    updateUrlTimer = null;
    updateUrl();
  }, 180);
};

const viewportForMunicipality = () =>
  state.viewport || state.municipality?.viewport || state.runtimeConfig?.initialViewport || null;

const regionSelector = createRegionSelector({
  regionSelect: elements.region,
  municipalitySelect: elements.municipality,
  fetchJson,
  state,
  onChange: async () => {
    state.viewport = null;
    await loadMap();
  },
});

const searchLoader = createLayerSearchLoader({ fetchJson });

// 全国の市区町村索引。現在地域の一覧だけだと「広島市」と打っても
// 岡山を見ているあいだは1件も出ない。
const loadNationwideMunicipalities = async () => {
  if (state.allMunicipalities.length > 0) return state.allMunicipalities;
  try {
    const index = await fetchJson('/map/regions/municipalities-index.json');
    state.allMunicipalities = Array.isArray(index?.municipalities) ? index.municipalities : [];
  } catch (error) {
    // 索引が無くても現在地域ぶんでは検索できる。致命ではない。
    console.warn('[native-map] municipality index unavailable', error);
    state.allMunicipalities = [];
  }
  return state.allMunicipalities;
};

const searchMunicipalities = () => (
  state.allMunicipalities.length > 0 ? state.allMunicipalities : state.municipalities
);

const loadSearchIndex = async () => {
  state.searchRecords = [];
  void loadNationwideMunicipalities().then(() => {
    state.searchCorpus = createSearchCorpus({
      regions: state.regions,
      municipalities: searchMunicipalities(),
      records: state.searchRecords,
    });
  });
  state.searchCorpus = createSearchCorpus({
    regions: state.regions,
    municipalities: searchMunicipalities(),
    records: [],
  });
  const records = await searchLoader.load({
    layers: state.searchLayers,
    regionId: state.regionId,
  });
  if (!records) return;
  state.searchRecords = records;
  await loadNationwideMunicipalities();
  state.searchCorpus = createSearchCorpus({
    regions: state.regions,
    municipalities: searchMunicipalities(),
    records,
  });
};

const searchCandidates = (query) => searchCorpus(state.searchCorpus, query);

const closeSearchResults = () => {
  elements.searchResults.hidden = true;
};

const resultSymbol = (result) => {
  if (result.type === 'region') return '県';
  if (result.type === 'municipality') return '市';
  if (result.symbol) return result.symbol;
  return '地';
};

const focusSearchResult = async (result) => {
  elements.search.value = result.title;
  elements.searchClear.hidden = false;
  closeSearchResults();
  if (result.type === 'region') {
    await regionSelector.selectRegion(result.id);
    return;
  }
  if (result.type === 'municipality') {
    // 別の県の市区町村なら、まずその県へ切り替える。
    // 切り替えないと現在地域の一覧に無く、選択が黙って失敗する。
    if (result.regionId && result.regionId !== state.regionId) {
      await regionSelector.selectRegion(result.regionId, false);
    }
    await regionSelector.selectMunicipality(result.id);
    return;
  }
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) return;
  const layerIds = [result.targetLayerId].filter(Boolean);
  for (const id of layerIds) {
    const layer = state.layers.find((entry) => entry.id === id);
    if (layer) layer.visible = true;
    toggleLayer(id, true);
  }
  renderLayers();
  postToMap({
    type: MAP_MESSAGES.mapSetViewport,
    viewport: {
      lat: result.lat,
      lon: result.lon,
      latSpan: 0.025,
      lonSpan: 0.025,
    },
  });
  setStatus(`${result.title}を表示中`, true);
};

const renderSearchResults = () => {
  const results = searchCandidates(elements.search.value);
  elements.searchResultList.replaceChildren();
  elements.searchEmpty.hidden = results.length > 0;
  for (const result of results) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result-button';
    const icon = document.createElement('span');
    icon.className = 'search-result-icon';
    icon.textContent = resultSymbol(result);
    const copy = document.createElement('span');
    copy.className = 'search-result-copy';
    const title = document.createElement('strong');
    title.textContent = result.title;
    const subtitle = document.createElement('small');
    subtitle.textContent = result.subtitle || result.layerLabel || '';
    copy.append(title, subtitle);
    button.append(icon, copy);
    button.addEventListener('click', () => void focusSearchResult(result));
    item.append(button);
    elements.searchResultList.append(item);
  }
  elements.searchResults.hidden = !elements.search.value.trim();
};

const applyViewport = () => {
  const viewport = viewportForMunicipality();
  if (!viewport) return;
  postToMap({ type: MAP_MESSAGES.mapSetViewport, viewport });
};

const toggleLayer = (id, visible, { openController = false } = {}) => {
  const layer = state.layers.find((entry) => entry.id === id);
  const wasVisible = Boolean(layer?.visible);
  let switchedPeer = false;
  // SVGMap の `class="basemap switch"` は排他的な背景グループ。ランタイムだけに
  // 任せると、別背景を選んだ後もホスト側のチェック状態が以前のまま残る。
  // 同じ switch グループの状態もここで揃える。offline-fallback は別クラスなので
  // この排他制御には入らず、オンライン背景の下で常に表示されたままになる。
  if (layer && visible) {
    const classTokens = new Set(String(layer.className || '').split(/\s+/).filter(Boolean));
    if (classTokens.has('switch')) {
      const groupTokens = [...classTokens].filter((token) => token !== 'switch');
      for (const peer of state.layers) {
        if (peer.id === id || !peer.visible) continue;
        const peerTokens = new Set(String(peer.className || '').split(/\s+/).filter(Boolean));
        if (!peerTokens.has('switch') || !groupTokens.some((token) => peerTokens.has(token))) continue;
        peer.visible = false;
        if (peer.attrs) peer.attrs.visibility = 'hidden';
        state.visibleLayerIds?.delete(peer.id);
        postToMap({
          type: MAP_MESSAGES.mapSetLayerVisible,
          layerKey: peer.toggleKey || peer.id,
          visible: false,
        });
        switchedPeer = true;
      }
    }
  }
  if (layer) {
    layer.visible = visible;
    if (layer.attrs) layer.attrs.visibility = visible ? 'visible' : 'hidden';
  }
  if (layer?.imported && !layer.transient) saveImportedLayers(state.layers);
  if (!state.visibleLayerIds) state.visibleLayerIds = new Set();
  if (visible) state.visibleLayerIds.add(id);
  else state.visibleLayerIds.delete(id);
  postToMap({
    type: MAP_MESSAGES.mapSetLayerVisible,
    layerKey: layer?.toggleKey || id,
    visible,
  });
  // 利用者がサイドバーでcontroller付きレイヤーをOFF→ONにした時だけ開く。
  // 起動時の状態復元や再読込では勝手に開かない。
  if (openController && visible && !wasVisible && layer?.controllerUi) {
    openLayerController(layer);
  }
  if (switchedPeer) layerPanel.renderLayers();
  else layerPanel.updateCount();
  scheduleUrlUpdate();
};

// ---- データ鮮度表示 -------------------------------------------------------
// 判定は shared/dataFreshness.js (純粋関数) に置いてある。ここは描画だけ。

let dataStatusTimer = null;

const renderDataStatus = () => {
  const view = dataFreshnessView({
    entries: [...state.dataStatus.values()],
    online: navigator.onLine,
  });

  elements.dataStatusBar.replaceChildren();
  elements.dataStatusBar.hidden = !view;
  if (dataStatusTimer) {
    clearInterval(dataStatusTimer);
    dataStatusTimer = null;
  }
  if (!view) return;

  elements.dataStatusBar.dataset.level = view.level;
  const strong = document.createElement('strong');
  strong.textContent = view.title;
  const span = document.createElement('span');
  span.textContent = view.detail;
  elements.dataStatusBar.append(strong, span);

  // 「◯分前」を放置すると嘘になるので、表示中だけ1分ごとに描き直す。
  dataStatusTimer = setInterval(renderDataStatus, 60_000);
};

const recordDataStatus = (payload) => {
  const entry = normalizeDataStatus(payload);
  if (!entry) return;
  if (entry.resolved) state.dataStatus.delete(entry.key);
  else state.dataStatus.set(entry.key, entry);
  renderDataStatus();
};

window.addEventListener('online', renderDataStatus);
window.addEventListener('offline', renderDataStatus);

// ---- オフライン保存UI -----------------------------------------------------
// 表示は必ず Service Worker の実キャッシュ検証結果に基づく。

let offlineProgress = null;

const regionLabels = () => Object.fromEntries(
  state.regions.map((region) => [region.id, region.label || region.id]),
);

const setOfflineStatus = (message) => {
  elements.offlineStorageStatus.textContent = message?.text || '';
  elements.offlineStorageStatus.dataset.tone = message?.tone || '';
  elements.offlineStorageStatus.hidden = !message?.text;
};

const renderOfflineRegions = (statuses) => {
  const rows = offlineRegionRows({
    statuses,
    progress: offlineProgress,
    labels: regionLabels(),
  });
  elements.offlineRegionList.replaceChildren();
  elements.offlineStorageEmpty.hidden = rows.length > 0;

  for (const row of rows) {
    const item = document.createElement('li');
    item.className = 'offline-region';
    item.dataset.state = row.state;
    item.dataset.regionId = row.regionId;

    const copy = document.createElement('div');
    copy.className = 'offline-region-copy';
    const title = document.createElement('strong');
    title.textContent = row.label;
    if (row.pinned) {
      const pin = document.createElement('span');
      pin.className = 'offline-pin';
      pin.textContent = '明示保存';
      title.append(' ', pin);
    }
    const meta = document.createElement('span');
    meta.textContent = [row.stateLabel, row.savedAtLabel, row.bytesLabel !== '—' ? row.bytesLabel : '']
      .filter(Boolean).join('・');
    const note = document.createElement('small');
    note.textContent = row.note;
    copy.append(title, meta, note);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'offline-region-remove';
    remove.textContent = '削除';
    remove.title = `${row.label}の保存を削除`;
    remove.setAttribute('aria-label', remove.title);
    remove.disabled = !row.removable;
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      await removeRegion(row.regionId);
      setOfflineStatus({ tone: 'ok', text: `${row.label}の保存を削除しました` });
      await refreshOfflineRegions();
    });

    item.append(copy, remove);
    elements.offlineRegionList.append(item);
  }
};

const refreshOfflineRegions = async () => {
  if (!serviceWorkerSupported()) {
    elements.offlineSaveRegion.disabled = true;
    elements.offlineStorageEmpty.textContent = 'このブラウザではオフライン保存を利用できません';
    return;
  }
  const listed = await listCachedRegions();
  renderOfflineRegions(listed?.statuses || []);
};

const saveCurrentRegionOffline = async () => {
  const label = regionLabels()[state.regionId] || state.regionId;
  elements.offlineSaveRegion.disabled = true;
  offlineProgress = { regionId: state.regionId, stored: 0, total: 0 };
  setOfflineStatus({ tone: 'progress', text: `${label}を保存しています…` });
  await refreshOfflineRegions();
  try {
    // 明示保存は pin。以後 LRU で自動削除されない。
    const outcome = await cacheRegion(state.regionId, { pinned: true });
    setOfflineStatus(cacheOutcomeMessage(outcome, { label }));
  } finally {
    offlineProgress = null;
    elements.offlineSaveRegion.disabled = false;
    await refreshOfflineRegions();
  }
};

const ALERT_SEVERITY = {
  normal: 0,
  advisory: 1,
  evacuation: 2,
  danger: 3,
};
const alertSeverityLabel = (severity) => ({
  advisory: '氾濫注意',
  evacuation: '避難判断',
  danger: '氾濫危険',
}[severity] || '警戒情報');
const alertKey = (summary) => [
  summary.layerId,
  summary.maxSeverity,
  ...(summary.affected || []).map((item) => item.id).sort(),
].join(':');
const alertObservationLabel = (summary) => {
  const timestamp = Date.parse(summary.observedAt || '');
  if (!Number.isFinite(timestamp)) return '観測時刻不明';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}分前に観測`;
  return `${Math.floor(minutes / 60)}時間前に観測`;
};
const activeAlertCount = (summary) =>
  Number(summary.counts?.advisory || 0)
  + Number(summary.counts?.evacuation || 0)
  + Number(summary.counts?.danger || 0);

const focusAlert = (layer, summary) => {
  toggleLayer(layer.id, true);
  renderLayers();
  setLayerPanelOpen(false);
  const target = (summary.affected || []).find((item) =>
    Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
  if (target) {
    postToMap({
      type: MAP_MESSAGES.mapSetViewport,
      viewport: {
        lat: Number(target.lat),
        lon: Number(target.lon),
        latSpan: 0.08,
        lonSpan: 0.08,
      },
    });
  }
  setStatus(`${layer.title.replace(/^L\d+\s*/, '')}を表示中`, true);
};

const renderAlerts = () => {
  const candidates = state.layers
    .filter((layer) => layer.alertFeed)
    .map((layer) => ({ layer, summary: state.alertSummaries.get(layer.id) }))
    .filter(({ layer, summary }) => {
      if (!summary?.active || !(ALERT_SEVERITY[summary.maxSeverity] > 0)) return false;
      const observedAt = Date.parse(summary.observedAt || '');
      const staleAfter = Number(layer.alertFeed.staleAfterMinutes) * 60_000;
      if (!Number.isFinite(observedAt) || !Number.isFinite(staleAfter)) return false;
      if (Date.now() - observedAt > staleAfter) return false;
      return !state.dismissedAlerts.has(alertKey(summary));
    })
    .sort((a, b) =>
      ALERT_SEVERITY[b.summary.maxSeverity] - ALERT_SEVERITY[a.summary.maxSeverity]);

  elements.alertStack.replaceChildren();
  const current = candidates[0];
  elements.alertStack.hidden = !current;
  if (!current) return;
  const { layer, summary } = current;
  const card = document.createElement('section');
  card.className = 'alert-card';
  card.dataset.severity = summary.maxSeverity;
  card.setAttribute('role', 'alert');
  const copy = document.createElement('div');
  copy.className = 'alert-copy';
  const title = document.createElement('strong');
  title.textContent = `${alertSeverityLabel(summary.maxSeverity)}・${activeAlertCount(summary)}地点`;
  const detail = document.createElement('span');
  detail.textContent = `${layer.title.replace(/^L\d+\s*/, '')}・${alertObservationLabel(summary)}`;
  copy.append(title, detail);
  const actions = document.createElement('div');
  actions.className = 'alert-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'alert-open';
  open.textContent = '地図で確認';
  open.addEventListener('click', () => focusAlert(layer, summary));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'alert-close';
  close.textContent = '×';
  close.title = 'この警告を閉じる';
  close.setAttribute('aria-label', close.title);
  close.addEventListener('click', () => {
    state.dismissedAlerts.add(alertKey(summary));
    renderAlerts();
  });
  actions.append(open, close);
  card.append(copy, actions);
  elements.alertStack.append(card);
};

const alertPoller = createLayerAlertPoller({
  getLayers: () => state.layers,
  fetchJson,
  summaries: state.alertSummaries,
  onChange: renderAlerts,
});
const startAlertPolling = alertPoller.start;

const removeImportedLayer = (id) => {
  const removing = state.importedLayers.find((layer) => layer.id === id);
  const href = removing?.attrs?.['xlink:href'] || '';
  if (removing?.transient && href.startsWith('blob:')) URL.revokeObjectURL(href);
  state.importedLayers = state.importedLayers.filter((layer) => layer.id !== id);
  state.layers = state.layers.filter((layer) => layer.id !== id);
  state.visibleLayerIds?.delete(id);
  saveImportedLayers(state.importedLayers);
  postToMap({ type: MAP_MESSAGES.mapRemoveLayer, layerId: id });
  renderLayers();
  renderArtifactOptions();
  renderCommunityCompatibilityList();
  scheduleUrlUpdate();
};

const applyLayerPreset = (preset) => {
  const targetIds = Array.isArray(preset?.layers) ? preset.layers : [];
  let changed = 0;
  for (const id of targetIds) {
    const layer = state.layers.find((entry) => entry.id === id);
    if (!layer) continue;
    if (!layer.visible) changed += 1;
    toggleLayer(id, true);
  }
  renderLayers();
  setLayerPanelOpen(true);
  setStatus(changed > 0 ? preset.message : preset.alreadyMessage, true);
};

const layerPanel = createLayerPanel({
  elements: {
    layerList: elements.layerList,
    layerCount: elements.layerCount,
    layerPresets: elements.layerPresets,
  },
  getLayers: () => state.layers,
  getPresets: () => state.presets,
  onToggle: (id, visible) => toggleLayer(id, visible, { openController: visible }),
  onRemove: removeImportedLayer,
  onPreset: applyLayerPreset,
  onOpenController: (layer) => {
    if (!layer.visible) toggleLayer(layer.id, true);
    layerPanel.renderLayers();
    openLayerController(layer);
  },
});
const renderLayers = layerPanel.renderLayers;
const renderPresets = layerPanel.renderPresets;

const loadLayers = async (containerUrl) => {
  const catalog = await loadLayerCatalog({ containerUrl });
  const catalogLayers = catalog.layers;
  state.presets = catalog.presets;
  state.layers = [...catalogLayers, ...state.importedLayers];
  if (state.visibleLayerIds) {
    for (const layer of state.layers) layer.visible = state.visibleLayerIds.has(layer.id);
  } else {
    state.visibleLayerIds = new Set(state.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  }
  state.searchLayers = catalogLayers.filter((layer) => layer.search?.kind === 'qtct');
  renderPresets();
  renderLayers();
  renderCommunityCompatibilityList();
  void loadLayerHealthData({ layers: state.layers, fetchJson }).then(renderLayers);
  startAlertPolling();
  renderArtifactOptions();
};

const setImportStatus = (message, error = false) => {
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle('error', error);
};

const communityEntryHref = (entry) => {
  const raw = entry.adapterHref || entry.animation?.['xlink:href'] || entry.href || '';
  return new URL(raw, new URL('/map/svgMapAppLayers/Container.svg', location.href)).href;
};

const renderCommunityCompatibilityList = () => {
  const labels = {
    supported: '検証済み',
    limited: 'オンライン限定',
    unverified: '未検証',
    incompatible: '非対応',
    'requires-config': '要設定',
    'requires-proxy': '要プロキシ',
  };
  const catalog = state.communityCatalog;
  if (!catalog) return;
  const query = elements.communityCatalogSearch.value.trim().toLocaleLowerCase('ja');
  const entries = (catalog.entries || []).filter((entry) => (
    !query || [entry.title, entry.reason, ...(entry.externalDependencies || [])]
      .join(' ')
      .toLocaleLowerCase('ja')
      .includes(query)
  ));
  const installed = new Set(state.importedLayers.map((layer) => layer.attrs?.['xlink:href']));
  const mountedTitles = new Set(state.layers
    .filter((layer) => layer.community)
    .map((layer) => layer.title));
  elements.communityCompatibilityList.replaceChildren();
  const rank = { supported: 0, limited: 1, 'requires-proxy': 2, 'requires-config': 3, incompatible: 4, unverified: 5 };
  for (const entry of [...entries].sort((a, b) => (
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.sourceIndex - b.sourceIndex
  ))) {
    const row = document.createElement('li');
    row.dataset.status = entry.status;
    const heading = document.createElement('span');
    heading.className = 'community-entry-heading';
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const actions = document.createElement('span');
    actions.className = 'community-entry-actions';
    const badge = document.createElement('small');
    badge.textContent = labels[entry.status] || entry.status;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'community-entry-add';
    const isInstalled = installed.has(communityEntryHref(entry)) || mountedTitles.has(entry.title);
    const blocked = entry.status === 'incompatible';
    add.disabled = isInstalled || blocked;
    add.textContent = isInstalled ? '搭載済み' : blocked ? '非対応' : entry.status === 'requires-config' ? '設定して追加' : '追加';
    add.setAttribute('aria-label', `${entry.title}を現在の地図へ追加`);
    add.addEventListener('click', () => {
      add.disabled = true;
      elements.communityCatalogStatus.classList.remove('error');
      try {
        const configuration = Object.fromEntries(
          [...row.querySelectorAll('[data-community-config]')]
            .map((input) => [input.dataset.communityConfig, input.value]),
        );
        addImportedLayers([importBundledCommunityLayer(entry, { configuration })]);
        renderCommunityCompatibilityList();
        elements.communityCatalogStatus.textContent = `${entry.title}を追加しました`;
      } catch (error) {
        add.disabled = false;
        elements.communityCatalogStatus.textContent = error.message;
        elements.communityCatalogStatus.classList.add('error');
      }
    });
    actions.append(badge, add);
    heading.append(title, actions);
    const reason = document.createElement('p');
    const dependencies = (entry.externalDependencies || []).join(', ');
    reason.textContent = `区分${entry.category} · ${entry.reason}${dependencies ? ` · ${dependencies}` : ''}`;
    row.append(heading, reason);
    for (const field of entry.configuration?.fields || []) {
      const label = document.createElement('label');
      label.className = 'community-entry-config';
      const caption = document.createElement('span');
      caption.textContent = field.label;
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.required = Boolean(field.required);
      input.placeholder = field.placeholder || '';
      input.dataset.communityConfig = field.name;
      input.autocomplete = 'url';
      label.append(caption, input);
      row.append(label);
    }
    elements.communityCompatibilityList.append(row);
  }
  elements.communityCatalogStatus.textContent = query ? `${entries.length}件` : '';
};

const renderCommunityCompatibility = async () => {
  try {
    const catalog = await fetchJson('/map/layers/external/svgmap-app-layers/compatibility.json');
    state.communityCatalog = catalog;
    // 以前の版で追加済みのレイヤーにも、最新カタログのcontroller情報を補う。
    // localStorageを消さなくても、埋め込みcontrollerを持つ本家レイヤーに操作ボタンが出る。
    let importedMetadataChanged = false;
    for (const layer of state.importedLayers) {
      const entry = (catalog.entries || []).find((candidate) => (
        candidate.title === layer.title
        || communityEntryHref(candidate) === layer.attrs?.['xlink:href']
      ));
      if (!entry) continue;
      if (entry.controller && !layer.controllerUi) {
        layer.controllerUi = { label: '設定' };
        importedMetadataChanged = true;
      }
    }
    if (importedMetadataChanged) {
      saveImportedLayers(state.importedLayers);
      renderLayers();
    }
    const counts = catalog.counts || {};
    elements.communityCompatibilitySummary.textContent =
      `検証${counts.supported || 0}・制限${counts.limited || 0}／${catalog.entries?.length || 0}件`;
    renderCommunityCompatibilityList();
  } catch (error) {
    elements.communityCompatibilitySummary.textContent = '互換性一覧を取得できません';
    console.warn('[native-map] community compatibility unavailable', error);
  }
};

const artifactBrowser = createArtifactBrowser({ state, elements, fetchJson });
const renderArtifactOptions = artifactBrowser.renderOptions;
const renderArtifactMetadata = artifactBrowser.renderMetadata;
const loadLocalArtifactIndex = artifactBrowser.loadLocal;
const loadSignedArtifactIndex = artifactBrowser.loadSigned;

void renderCommunityCompatibility();

const setImportKindFields = () => {
  const kind = elements.importKind.value;
  const artifact = kind === 'artifact' || kind === 'signed-index';
  const signedIndex = kind === 'signed-index';
  const singleLayer = kind === 'layer';
  elements.importArtifact.hidden = !artifact;
  elements.importIndexUrl.hidden = !signedIndex;
  elements.importIndexActions.hidden = !signedIndex;
  elements.importArtifactMeta.hidden = !artifact;
  elements.artifactDownload.hidden = true;
  elements.artifactDescription.hidden = true;
  elements.artifactActionHelp.hidden = true;
  elements.importUrl.hidden = artifact;
  elements.importTitle.hidden = !singleLayer;
  elements.importFile.hidden = !singleLayer;
  if (!singleLayer) elements.importFile.value = '';
  elements.importUrl.placeholder = singleLayer
    ? 'https://example.jp/layer.svg または下でファイル選択'
    : 'https://example.jp/Container.svg';
  elements.importSubmit.textContent = artifact ? 'この地図で表示' : '追加';
  elements.importSubmit.disabled = artifact && elements.importArtifact.options.length === 0;
  setImportStatus('');
  if (kind === 'artifact') {
    void loadLocalArtifactIndex().catch((error) => setImportStatus(error.message, true));
  } else if (signedIndex && !state.artifactIndexExternal) {
    artifactBrowser.reset();
  }
};

const addImportedLayers = (layers) => {
  const knownHrefs = new Set(state.importedLayers.map((layer) => layer.attrs?.['xlink:href']));
  const additions = layers.filter((layer) => !knownHrefs.has(layer.attrs?.['xlink:href']));
  if (additions.length === 0) throw new Error('同じレイヤーは追加済みです');
  state.importedLayers.push(...additions);
  state.layers.push(...additions);
  if (!state.visibleLayerIds) state.visibleLayerIds = new Set();
  for (const layer of additions) {
    if (layer.visible) state.visibleLayerIds.add(layer.id);
  }
  saveImportedLayers(state.importedLayers);
  renderLayers();
  renderCommunityCompatibilityList();
  if (state.runtimeReady) {
    postToMap({ type: MAP_MESSAGES.mapImportLayers, layers: additions });
  }
  renderArtifactOptions();
  scheduleUrlUpdate();
  return additions;
};

const importExternalLayers = async () => {
  const kind = elements.importKind.value;
  if (kind === 'artifact' || kind === 'signed-index') {
    if (kind === 'artifact') await loadLocalArtifactIndex();
    if (kind === 'signed-index' && !state.artifactIndexExternal) throw new Error('先に配布一覧の署名を確認してください');
    const artifact = artifactBrowser.selectedArtifact();
    if (!artifact) throw new Error('検証済みレイヤーを選択してください');
    const mounted = state.layers.find((layer) => layer.id === artifact.layerId);
    if (mounted) {
      const wasVisible = mounted.visible;
      if (!wasVisible) toggleLayer(mounted.id, true);
      renderLayers();
      renderArtifactOptions();
      renderCommunityCompatibilityList();
      return { additions: [], message: wasVisible ? 'すでに表示しています' : `${mounted.title}を表示しました` };
    }
    const verified = await fetchVerifiedArtifactContainer(artifact, state.artifactIndexUrl);
    const additions = addImportedLayers(importContainerText(verified.text, verified.url, {
      lawaMode: state.artifactIndexExternal ? 'isolated' : 'tight',
      sourceType: state.artifactIndexExternal ? 'signed-artifact' : 'verified-artifact',
      initialVisibility: 'visible',
      publisher: artifact.distribution?.publisher?.name || '',
      license: artifact.distribution?.license || null,
      verifiedAt: artifact.distribution?.publishedAt || null,
      offline: artifact.portability?.offline === true,
    }));
    return { additions, message: `${additions.length}件を追加しました` };
  }
  const rawUrl = elements.importUrl.value.trim();
  const localFile = elements.importFile.files?.[0] || null;
  if (kind === 'layer') {
    if (localFile) {
      const additions = addImportedLayers([
        importLocalLayerFile(localFile, elements.importTitle.value),
      ]);
      return { additions, message: `${additions.length}件を追加しました` };
    }
    if (!rawUrl) throw new Error('URLまたはSVG/HTMLファイルを指定してください');
    const additions = addImportedLayers([
      importSingleLayer({ url: rawUrl, title: elements.importTitle.value }),
    ]);
    return { additions, message: `${additions.length}件を追加しました` };
  }
  if (!rawUrl) throw new Error('URLを入力してください');
  const sourceUrl = new URL(rawUrl, location.href).href;
  const response = await fetch(sourceUrl, { mode: 'cors' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const layers = importContainerText(await response.text(), response.url || sourceUrl);
  if (layers.length > 200) throw new Error('一度に追加できるレイヤーは200件までです');
  const additions = addImportedLayers(layers);
  return { additions, message: `${additions.length}件を追加しました` };
};

const municipalityCodes = () =>
  (state.municipality?.municipalityCodes || []).join(',');

const loadMap = async () => {
  state.runtimeReady = false;
  state.acceptViewportUpdates = false;
  state.mapSession = `${Date.now().toString(36)}-${++mapSessionCounter}`;
  // 前の地域の鮮度情報を引き継ぐと別地域の取得時刻を表示してしまう。
  state.dataStatus.clear();
  renderDataStatus();
  elements.loading.hidden = false;
  setStatus('地図を読み込み中');
  const runtimeUrl = `/map/regions/${encodeURIComponent(state.regionId)}/runtime-config.json`;
  state.runtimeConfig = await fetchJson(runtimeUrl);
  await loadLayers(state.runtimeConfig.containerUrl);

  const mapParams = new URLSearchParams({
    embed: '1',
    regionId: state.regionId,
    runtimeConfigUrl: runtimeUrl,
    mapSession: state.mapSession,
    v: 'native-static-29',
  });
  const initialViewport = viewportForMunicipality();
  if (initialViewport) {
    mapParams.set('initialViewport', [
      initialViewport.lat,
      initialViewport.lon,
      initialViewport.latSpan,
      initialViewport.lonSpan,
    ].join(','));
  }
  const codes = municipalityCodes();
  if (codes) mapParams.set('municipalityCodes', codes);
  elements.frame.src = `/map/webapp/current-map.html?${mapParams}`;
  updateUrl();
  void loadSearchIndex();
  // 表示した地域の静的資産を自動保存する（pin はしない。明示保存とは別扱い）。
  // 地図表示は待たせない（保存は数十秒かかりうる）。
  void cacheRegion(state.regionId).then(async (result) => {
    if (result) console.info('[native-map] region cached', result);
    await refreshOfflineRegions();
  });
  void refreshOfflineRegions();
};

elements.search.addEventListener('input', () => {
  elements.searchClear.hidden = !elements.search.value;
  renderSearchResults();
});
elements.search.addEventListener('focus', renderSearchResults);
elements.search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeSearchResults();
    elements.search.blur();
  }
  if (event.key === 'Enter') {
    const first = elements.searchResultList.querySelector('button');
    first?.click();
  }
});
elements.searchClear.addEventListener('click', () => {
  elements.search.value = '';
  elements.searchClear.hidden = true;
  closeSearchResults();
  elements.search.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.search-box')) closeSearchResults();
  if (!event.target.closest('#app-menu') && !event.target.closest('#app-menu-button')) setAppMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || elements.appMenu.hidden) return;
  setAppMenuOpen(false);
  elements.appMenuButton.focus();
});
elements.appMenuButton.addEventListener('click', () => {
  setAppMenuOpen(elements.appMenu.hidden);
});
elements.menuImportLayer?.addEventListener('click', () => openImportFromMenu('layer'));
elements.menuImportArtifact?.addEventListener('click', () => openImportFromMenu('artifact'));
elements.layerButton.addEventListener('click', () => {
  setAppMenuOpen(false);
  setLayerPanelOpen(!elements.layerPanel.classList.contains('open'));
});
elements.panelClose.addEventListener('click', () => setLayerPanelOpen(false));
elements.importButton?.addEventListener('click', () => {
  setImportFormOpen(elements.importForm.hidden);
});
elements.importKind.addEventListener('change', setImportKindFields);
elements.communityCatalogSearch.addEventListener('input', renderCommunityCompatibilityList);
elements.importArtifact.addEventListener('change', renderArtifactMetadata);
elements.importIndexLoad.addEventListener('click', async () => {
  elements.importIndexLoad.disabled = true;
  setImportStatus('署名を確認中...');
  try {
    const artifacts = await loadSignedArtifactIndex();
    setImportStatus(`${artifacts.length}件の署名を確認しました`);
  } catch (error) {
    artifactBrowser.reset();
    setImportStatus(error instanceof TypeError ? '取得できません。URLまたはCORS設定を確認してください' : error.message, true);
  } finally {
    elements.importIndexLoad.disabled = false;
  }
});
elements.importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.importSubmit.disabled = true;
  setImportStatus('確認中...');
  try {
    const result = await importExternalLayers();
    setImportStatus(result.message);
    elements.importUrl.value = '';
    elements.importFile.value = '';
    elements.importTitle.value = '';
  } catch (error) {
    console.error('[native-map] layer import failed', error);
    const cors = error instanceof TypeError ? '取得できません。URLまたはCORS設定を確認してください' : error.message;
    setImportStatus(cors, true);
  } finally {
    elements.importSubmit.disabled = false;
  }
});
document.getElementById('zoom-in').addEventListener('click', () => {
  postToMap({ type: MAP_MESSAGES.mapZoom, factor: 0.8 });
});
document.getElementById('zoom-out').addEventListener('click', () => {
  postToMap({ type: MAP_MESSAGES.mapZoom, factor: 1.25 });
});
document.getElementById('reset-view').addEventListener('click', applyViewport);
document.getElementById('location-button').addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('現在地を取得できません');
    return;
  }
  setStatus('現在地を取得中');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      postToMap({
        type: MAP_MESSAGES.mapFocusLocation,
        location: {
          lat: coords.latitude,
          lon: coords.longitude,
          latSpan: 0.03,
          lonSpan: 0.03,
        },
      });
      setStatus('現在地を表示中', true);
    },
    () => setStatus('現在地を取得できません', state.runtimeReady),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== elements.frame.contentWindow) return;
  const message = event.data || {};
  if (state.mapSession && message.payload?.mapSession !== state.mapSession) return;
  if (message.type === MAP_MESSAGES.runtimeViewportChanged) {
    if (!state.acceptViewportUpdates) return;
    const viewport = message.payload || {};
    const values = [viewport.lat, viewport.lon, viewport.latSpan, viewport.lonSpan].map(Number);
    if (values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
      state.viewport = {
        lat: values[0],
        lon: values[1],
        latSpan: values[2],
        lonSpan: values[3],
      };
      scheduleUrlUpdate();
    }
    return;
  }
  if (message.type === MAP_MESSAGES.runtimeDataStatus) {
    recordDataStatus(message.payload || {});
    return;
  }
  if (message.type === MAP_MESSAGES.runtimeLayerStateChanged) {
    const layerId = String(message.payload?.layerId || '');
    const layerState = String(message.payload?.state ?? '');
    if (!state.layers.some((layer) => layer.id === layerId || layer.toggleKey === layerId) || layerState.length > 2000) return;
    if (layerState) state.layerStates[layerId] = layerState;
    else delete state.layerStates[layerId];
    scheduleUrlUpdate();
    return;
  }
  if (message.type === MAP_MESSAGES.runtimeLayerUiVisibilityChanged) {
    const visible = message.payload?.visible === true;
    document.body.classList.toggle('controller-open', visible);
    if (visible) {
      setLayerPanelOpen(false);
    } else if (restoreLayerPanelAfterController) {
      restoreLayerPanelAfterController = false;
      setLayerPanelOpen(true);
    }
    return;
  }
  if (message.type === MAP_MESSAGES.runtimeStartupMetrics) {
    const metrics = {
      durationMs: Number(message.payload?.durationMs) || 0,
      resourceCount: Number(message.payload?.resourceCount) || 0,
      transferBytes: Number(message.payload?.transferBytes) || 0,
      loadedLayerIds: Array.isArray(message.payload?.loadedLayerIds)
        ? message.payload.loadedLayerIds.map(String)
        : [],
      controllerLayerIds: Array.isArray(message.payload?.controllerLayerIds)
        ? message.payload.controllerLayerIds.map(String)
        : [],
    };
    window.__svg3StartupMetrics = metrics;
    window.dispatchEvent(new CustomEvent('svg3:startupMetrics', { detail: metrics }));
    console.info('[native-map] startup metrics', metrics);
    return;
  }
  if (message.type === MAP_MESSAGES.runtimeReady) {
    state.runtimeReady = true;
    elements.loading.hidden = true;
    setStatus(`${state.municipality?.label || state.runtimeConfig?.label || state.regionId}を表示中`, true);
    syncMapUiInsets();
    applyViewport();
    state.acceptViewportUpdates = true;
    if (state.importedLayers.length > 0) {
      postToMap({ type: MAP_MESSAGES.mapImportLayers, layers: state.importedLayers });
    }
    for (const layer of state.layers) {
      toggleLayer(layer.id, layer.visible);
    }
    for (const [layerId, layerState] of Object.entries(state.layerStates)) {
      postToMap({ type: MAP_MESSAGES.mapSetLayerState, layerId, state: layerState });
    }
  }
});

elements.offlineSaveRegion.addEventListener('click', () => void saveCurrentRegionOffline());

// 進行中の保存や、他タブでの保存/削除を表示へ反映する。
onCacheEvent((event) => {
  if (event.type === 'sw:regionProgress') {
    offlineProgress = { regionId: event.regionId, stored: event.stored, total: event.total };
    void refreshOfflineRegions();
    return;
  }
  if (event.type === 'sw:regionCached' || event.type === 'sw:regionRemoved') {
    offlineProgress = null;
    void refreshOfflineRegions();
  }
});

const start = async () => {
  // 登録は起動を待たせない。SW が使えない環境でもオンライン利用は成立する。
  void registerServiceWorker();
  try {
    await regionSelector.start();
    await loadMap();
  } catch (error) {
    console.error('[native-map] startup failed', error);
    elements.loading.textContent = '地図を読み込めませんでした';
    setStatus('静的データの読み込みに失敗しました');
  }
};

if (innerWidth > 820) {
  setLayerPanelOpen(true);
}
window.addEventListener('resize', syncMapUiInsets);
setImportKindFields();
updatePublisherLink();
void start();
