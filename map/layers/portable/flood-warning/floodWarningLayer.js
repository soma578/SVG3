import { fetchWithRuntimeCache } from '../representative-pins/runtimeCache.js';
import { MAP_MESSAGES } from '../representative-pins/mapMessages.js';
import { showPropertyModal } from '../representative-pins/propertyModal.js';
import {
  municipalityMap,
  latestReportDatetime,
  unmappedAreas,
  warningRecords,
  warningRecordsWithinHours,
} from './jmaWarnings.js';
import { renderFloodWarningDetail } from './floodWarningDetail.js';
import { createPortableNetworkClient } from '../portable-network/safeFetch.js';

export const JMA_WARNING_URL = 'https://www.jma.go.jp/bosai/warning/data/r8/map.json';
export const MUNICIPALITY_INDEX_URL = '/map/regions/municipalities-index.json';
export const JMA_WARNING_ATTRIBUTION = {
  label: '気象庁「気象警報・注意報」',
  url: 'https://www.jma.go.jp/bosai/warning/',
};

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const DRAW_GROUP_ID = 'flood-warning-points';
export const WARNING_PIN_SIZE = 26;
export const WARNING_ICON_PATHS = Object.freeze({
  emergency: new URL('./warning-emergency.svg', import.meta.url).href,
  warning: new URL('./warning-warning.svg', import.meta.url).href,
  advisory: new URL('./warning-advisory.svg', import.meta.url).href,
  unknown: new URL('./warning-unknown.svg', import.meta.url).href,
});

const LEVEL_STYLE = {
  emergency: { icon: WARNING_ICON_PATHS.emergency },
  warning: { icon: WARNING_ICON_PATHS.warning },
  advisory: { icon: WARNING_ICON_PATHS.advisory },
  unknown: { icon: WARNING_ICON_PATHS.unknown },
};

const postDataStatus = (payload) => {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: MAP_MESSAGES.runtimeDataStatus,
    payload: { online: navigator.onLine, updatedAt: new Date().toISOString(), ...payload },
  }, window.location.origin === 'null' ? '*' : window.location.origin);
};

const featurePayload = (record) => ({
  id: record.id,
  title: record.title,
  layerId: record.layerId,
  kind: record.kind,
  status: record.status,
  lat: record.lat,
  lon: record.lon,
  municipalityCode: record.municipalityCode,
  regionId: record.regionId,
  summary: record.summary,
  observedAt: record.observedAt,
  kinds: record.kinds,
});

const ensureDefs = () => {
  const svg = window.svgImage;
  const defs = svg?.getElementsByTagName?.('defs')?.[0];
  if (!svg?.createElement || !defs) return;
  for (const [level, style] of Object.entries(LEVEL_STYLE)) {
    const id = `flood-warning-${level}`;
    if (svg.getElementById?.(id)) continue;
    const group = svg.createElement('g');
    group.setAttribute('id', id);
    const image = svg.createElement('image');
    const half = WARNING_PIN_SIZE / 2;
    image.setAttribute('x', String(-half));
    image.setAttribute('y', String(-half));
    image.setAttribute('width', String(WARNING_PIN_SIZE));
    image.setAttribute('height', String(WARNING_PIN_SIZE));
    image.setAttribute('href', style.icon);
    image.setAttributeNS(XLINK_NS, 'xlink:href', style.icon);
    image.setAttribute('pointer-events', 'none');
    group.append(image);
    defs.appendChild(group);
  }
};

const inView = (record, view) => {
  if (!view) return true;
  // getGeoViewBox() は SVGの100倍座標ではなく、経緯度の視野を返す。
  const left = Number(view.x);
  const bottom = Number(view.y);
  const right = left + Number(view.width);
  const top = bottom + Number(view.height);
  return record.lon >= left && record.lon <= right && record.lat >= bottom && record.lat <= top;
};

export const initFloodWarningLayer = ({ onStateChange = null } = {}) => {
  window.hiddenOnLayerLoad = () => {};
  const layerBaseUrl = new URL('./', import.meta.url).href;
  const network = createPortableNetworkClient({
    manifestUrl: new URL('layer.package.json', layerBaseUrl).href,
    baseUrl: layerBaseUrl,
  });
  const state = {
    records: [], loaded: false, loading: false, signature: '', displayWindowHours: 24,
    fetchedAt: null, latestObservedAt: null, source: null, error: '', visibleCount: 0,
  };
  const publishState = () => onStateChange?.({
    loading: state.loading,
    loaded: state.loaded,
    displayWindowHours: state.displayWindowHours,
    totalCount: state.records.length,
    visibleCount: state.visibleCount,
    fetchedAt: state.fetchedAt,
    latestObservedAt: state.latestObservedAt,
    source: state.source,
    error: state.error,
  });
  let refreshTimer = null;
  let poiRefreshTimer = null;

  const schedulePoiRefresh = () => {
    if (poiRefreshTimer) return;
    poiRefreshTimer = window.setTimeout(() => {
      poiRefreshTimer = null;
      Promise.resolve(window.svgMap?.refreshScreen?.()).catch(() => {});
    }, 50);
  };

  const draw = () => {
    if (!state.loaded || !window.svgImage?.createElement) return;
    ensureDefs();
    const view = window.svgMap?.getGeoViewBox?.();
    const periodRecords = warningRecordsWithinHours(state.records, state.displayWindowHours);
    const visible = periodRecords.filter((record) => inView(record, view));
    state.visibleCount = periodRecords.length;
    const signature = [
      visible.map((record) => record.id + ':' + record.status).join(','),
      Number(view?.x).toFixed(3), Number(view?.y).toFixed(3),
      Number(view?.width).toFixed(3), Number(view?.height).toFixed(3),
      state.displayWindowHours,
    ].join('|');
    if (signature === state.signature) return;
    state.signature = signature;
    window.svgImage.getElementById?.(DRAW_GROUP_ID)?.remove?.();
    const group = window.svgImage.createElement('g');
    group.setAttribute('id', DRAW_GROUP_ID);
    for (const record of visible) {
      const use = window.svgImage.createElement('use');
      const href = `#flood-warning-${record.status in LEVEL_STYLE ? record.status : 'unknown'}`;
      const feature = featurePayload(record);
      use.setAttribute('href', href);
      use.setAttributeNS(XLINK_NS, 'xlink:href', href);
      use.setAttribute('transform', `ref(svg,${(record.lon * 100).toFixed(5)},${(record.lat * -100).toFixed(5)})`);
      use.setAttribute('data-feature', JSON.stringify(feature));
      use.setAttribute('data-feature-id', record.id);
      use.setAttribute('data-layer-id', 'floodWarning');
      use.setAttribute('data-kind', 'warning-area');
      use.setAttribute('data-title', record.title);
      use.setAttribute('content', [record.title, record.status, record.summary, record.municipalityCode]
        .map((value) => String(value || '').replace(/[\r\n,]/g, ' ')).join(','));
      use.setAttribute('xlink:title', record.title);
      use.setAttribute('pointer-events', 'all');
      group.appendChild(use);
    }
    window.svgImage.documentElement.appendChild(group);
    window.svgImage.documentElement.setAttribute('data-native-poi-count', String(visible.length));
    schedulePoiRefresh();
    publishState();
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    publishState();
    try {
      const [municipalitiesResult, warningResult] = await Promise.all([
        fetchWithRuntimeCache(MUNICIPALITY_INDEX_URL, 'floodWarning:municipalities', {
          label: '市区町村索引', emitDataStatus: postDataStatus, logLabel: 'floodWarningLayer',
          fetchImpl: network.fetch,
        }),
        fetchWithRuntimeCache(JMA_WARNING_URL, 'floodWarning:jma', {
          label: '洪水・気象警報', emitDataStatus: postDataStatus, logLabel: 'floodWarningLayer',
          requestCache: 'no-cache',
          fetchImpl: network.fetch,
        }),
      ]);
      const municipalities = municipalityMap(municipalitiesResult.data);
      state.records = warningRecords(warningResult.data, municipalities);
      state.fetchedAt = new Date().toISOString();
      state.source = warningResult.source;
      state.latestObservedAt = state.records
        .map((record) => record.observedAt)
        .filter((value) => Number.isFinite(Date.parse(value || '')))
        .sort()
        .at(-1) || null;
      const missing = unmappedAreas(warningResult.data, municipalities);
      const observedAt = latestReportDatetime(warningResult.data);
      // runtimeCache cannot infer observedAt from the JMA top-level array, so report it explicitly.
      postDataStatus({
        key: 'floodWarning:jma', label: '洪水・気象警報', source: warningResult.source,
        url: JMA_WARNING_URL, observedAt,
        message: missing.length ? `未対応の市区町村コード ${missing.length}件` : '',
      });
      if (missing.length) console.warn('[floodWarningLayer] unmapped active areas', missing);
      state.loaded = true;
      state.signature = '';
      draw();
    } catch (error) {
      if (!state.loaded) state.records = [];
      state.error = error?.message || '取得できませんでした';
      state.loaded = true;
      state.signature = '';
      draw();
      console.error('[floodWarningLayer] load failed', error);
    } finally {
      state.loading = false;
      publishState();
    }
  };

  const setDisplayWindowHours = (hours) => {
    const next = Number(hours);
    state.displayWindowHours = Number.isFinite(next) && next >= 0 ? next : 24;
    state.signature = '';
    draw();
  };

  const showPoiProperty = (target) => {
    try {
      const feature = JSON.parse(target?.getAttribute?.('data-feature') || '{}');
      showPropertyModal(renderFloodWarningDetail(feature), {
        attribution: JMA_WARNING_ATTRIBUTION,
      });
    } catch (error) {
      console.warn('[floodWarningLayer] feature parse failed', error);
    }
  };

  window.preRenderFunction = draw;
  window.addEventListener('zoomPanMap', draw);
  let tries = 0;
  const handlerTimer = window.setInterval(() => {
    if (window.svgMap?.setShowPoiProperty && window.layerID) {
      window.svgMap.setShowPoiProperty(showPoiProperty, window.layerID);
      window.clearInterval(handlerTimer);
    } else if (++tries > 30) window.clearInterval(handlerTimer);
  }, 100);
  void load();
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'hidden' || !navigator.onLine) return;
    void load();
  }, 5 * 60_000);
  window.addEventListener('pagehide', () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (poiRefreshTimer) window.clearTimeout(poiRefreshTimer);
    window.clearInterval(handlerTimer);
  }, { once: true });
  return {
    refresh: load,
    setDisplayWindowHours,
    getState: () => ({ ...state, records: [...state.records] }),
  };
};

export default initFloodWarningLayer;
