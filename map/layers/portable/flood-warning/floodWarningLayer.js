import { fetchWithRuntimeCache } from '../representative-pins/runtimeCache.js';
import { MAP_MESSAGES } from '../representative-pins/mapMessages.js';
import { showPropertyModal } from '../representative-pins/propertyModal.js';
import { municipalityMap, oldestReportDatetime, unmappedAreas, warningRecords } from './jmaWarnings.js';
import { renderFloodWarningDetail } from './floodWarningDetail.js';

export const JMA_WARNING_URL = 'https://www.jma.go.jp/bosai/warning/data/warning/map.json';
export const MUNICIPALITY_INDEX_URL = '/map/regions/municipalities-index.json';

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const DRAW_GROUP_ID = 'flood-warning-points';
const LEVEL_STYLE = {
  emergency: { color: '#5b2386', label: '特' },
  warning: { color: '#c62828', label: '警' },
  advisory: { color: '#d68b00', label: '注' },
  unknown: { color: '#59636e', label: '?' },
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
    const circle = svg.createElement('circle');
    circle.setAttribute('cx', '0');
    circle.setAttribute('cy', '0');
    circle.setAttribute('r', '13');
    circle.setAttribute('fill', style.color);
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '3');
    const text = svg.createElement('text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '5');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', '800');
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('pointer-events', 'none');
    text.textContent = style.label;
    group.append(circle, text);
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

export const initFloodWarningLayer = () => {
  window.hiddenOnLayerLoad = () => {};
  const state = { records: [], loaded: false, loading: false, signature: '' };
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
    const visible = state.records.filter((record) => inView(record, view));
    const signature = [
      visible.map((record) => record.id + ':' + record.status).join(','),
      Number(view?.x).toFixed(3), Number(view?.y).toFixed(3),
      Number(view?.width).toFixed(3), Number(view?.height).toFixed(3),
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
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    try {
      const [municipalitiesResult, warningResult] = await Promise.all([
        fetchWithRuntimeCache(MUNICIPALITY_INDEX_URL, 'floodWarning:municipalities', {
          label: '市区町村索引', emitDataStatus: postDataStatus, logLabel: 'floodWarningLayer',
        }),
        fetchWithRuntimeCache(JMA_WARNING_URL, 'floodWarning:jma', {
          label: '洪水・気象警報', emitDataStatus: postDataStatus, logLabel: 'floodWarningLayer',
          requestCache: 'no-cache',
        }),
      ]);
      const municipalities = municipalityMap(municipalitiesResult.data);
      state.records = warningRecords(warningResult.data, municipalities);
      const missing = unmappedAreas(warningResult.data, municipalities);
      const observedAt = oldestReportDatetime(warningResult.data);
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
      state.records = [];
      state.loaded = true;
      state.signature = '';
      draw();
      console.error('[floodWarningLayer] load failed', error);
    } finally {
      state.loading = false;
    }
  };

  const showPoiProperty = (target) => {
    try {
      const feature = JSON.parse(target?.getAttribute?.('data-feature') || '{}');
      showPropertyModal(renderFloodWarningDetail(feature));
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
};

export default initFloodWarningLayer;
