import { showPropertyModal } from '../../layers/portable/representative-pins/propertyModal.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeHttpUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const fallbackCsvLine = (line) => String(line || '').split(',');

// Track setShowPoiProperty registrations without changing SVGMap's native API contract.
// SVG3's community formatter is only a fallback; a layer/controller registration always wins.
const propertyRegistrationStateBySvgMap = new WeakMap();

// Property callbacks can call svgMap.showModal directly (tight controller) or
// indirectly through the S-LaWA RPC bridge. Keep a small async-safe context
// while the registered property callback is running so the host can style only
// property modals, not arbitrary tool/controller modals.
export const COMMUNITY_PROPERTY_CONTEXT_KEY = Symbol.for('svg3.communityPropertyContextStack');

const propertyContextStack = () => {
  window[COMMUNITY_PROPERTY_CONTEXT_KEY] ||= [];
  return window[COMMUNITY_PROPERTY_CONTEXT_KEY];
};

const removePropertyContextEntry = (entry) => {
  const stack = propertyContextStack();
  const index = stack.lastIndexOf(entry);
  if (index >= 0) stack.splice(index, 1);
};

const runWithPropertyContext = (layerId, func, thisArg, args) => {
  const entry = Object.freeze({ layerId: String(layerId || '') });
  propertyContextStack().push(entry);

  let result;
  try {
    result = func.apply(thisArg, args);
  } catch (error) {
    removePropertyContextEntry(entry);
    throw error;
  }

  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(() => removePropertyContextEntry(entry));
  }

  removePropertyContextEntry(entry);
  return result;
};

const wrappedPropertyHandlers = new WeakMap();

const propertyHandlerWithContext = (func, layerId) => {
  if (typeof func !== 'function') return func;

  let byLayer = wrappedPropertyHandlers.get(func);
  if (!byLayer) {
    byLayer = new Map();
    wrappedPropertyHandlers.set(func, byLayer);
  }

  const id = String(layerId || '');
  if (byLayer.has(id)) return byLayer.get(id);

  const wrapped = function svg3PropertyContextHandler(...args) {
    return runWithPropertyContext(id, func, this, args);
  };

  byLayer.set(id, wrapped);
  return wrapped;
};

const getPropertyRegistrationState = (svgMap) => {
  let state = propertyRegistrationStateBySvgMap.get(svgMap);
  if (!state) {
    state = {
      installed: false,
      originalSetShowPoiProperty: null,
      registrations: new Map(),
      globalRegistration: null,
      fallbackHandlers: new WeakSet(),
    };
    propertyRegistrationStateBySvgMap.set(svgMap, state);
  }
  return state;
};

const clearSvg3FallbackBridge = (layerId) => {
  const id = String(layerId || '');
  if (!id) return;
  if (window.svg3CommunityPropertyAdapters?.[id]) {
    delete window.svg3CommunityPropertyAdapters[id];
  }
  if (window.svg3CommunityPropertyAdapter?.layerId === id) {
    window.svg3CommunityPropertyAdapter = null;
  }
};

export const installCommunityPropertyRegistrationMonitor = (
  svgMap = window.svgMap,
) => {
  if (!svgMap?.setShowPoiProperty) return false;

  const state = getPropertyRegistrationState(svgMap);
  if (state.installed) return true;

  const original = svgMap.setShowPoiProperty;
  state.originalSetShowPoiProperty = original;

  svgMap.setShowPoiProperty = function monitoredSetShowPoiProperty(func, docId) {
    const owner = typeof func === 'function' && state.fallbackHandlers.has(func)
      ? 'svg3-fallback'
      : 'native-or-layer';

    const registration = {
      owner,
      func: typeof func === 'function' ? func : null,
    };

    if (docId === undefined || docId === null || docId === '') {
      state.globalRegistration = registration;
    } else {
      const id = String(docId);
      state.registrations.set(id, registration);
      if (owner !== 'svg3-fallback') clearSvg3FallbackBridge(id);
    }

    const effectiveFunc = owner === 'native-or-layer' && typeof func === 'function'
      ? propertyHandlerWithContext(func, docId)
      : func;

    return original.call(this, effectiveFunc, docId);
  };

  state.installed = true;
  return true;
};

const hasNativePropertyRegistration = (svgMap, layerId) => {
  const state = getPropertyRegistrationState(svgMap);
  const local = state.registrations.get(String(layerId));

  if (local && local.owner !== 'svg3-fallback') return true;
  if (state.globalRegistration?.owner !== 'svg3-fallback') return true;

  return false;
};

export const communityRecordFromTarget = (target, svgMap = window.svgMap) => {
  const schema = String(target?.ownerDocument?.documentElement?.getAttribute?.('property') || '')
    .split(',')
    .map((key) => key.trim());
  const content = target?.getAttribute?.('content');
  if (!content) {
    const ignored = new Set(['content', 'transform', 'x', 'y', 'width', 'height', 'iid', 'data-layername']);
    return Object.fromEntries([...(target?.attributes || [])]
      .map((attribute) => [attribute.name, attribute.value])
      .filter(([key, value]) => !ignored.has(key) && String(value || '').trim()));
  }
  const values = typeof svgMap?.parseEscapedCsvLine === 'function'
    ? svgMap.parseEscapedCsvLine(content)
    : fallbackCsvLine(content);
  return Object.fromEntries(Array.from({ length: Math.max(schema.length, values.length) }, (_, index) => [
    schema[index] || `column${index + 1}`,
    values[index] ?? '',
  ]));
};

const dateTimeLabel = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || '—');
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Tokyo',
  }).format(date);
};

const rowMarkup = (label, value) => {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  return `<div class="svg3-property-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
};

const genericLabels = {
  title: '名称',
  name: '名称',
  latitude: '緯度',
  longitude: '経度',
  time: '時刻',
  updated: '更新時刻',
  status: '状態',
  type: '種別',
  source: '情報源',
};

export const genericCommunityProperty = (record, target) => {
  const title = record.title || record.name || target?.getAttribute?.('data-title')
    || target?.getAttribute?.('xlink:title') || target?.getAttribute?.('title') || 'レイヤー情報';
  const rows = Object.entries(record)
    .filter(([key]) => !['title', 'name'].includes(key.toLowerCase()))
    .map(([key, value]) => rowMarkup(genericLabels[key.toLowerCase()] || key, value))
    .join('');
  return {
    html: `<article class="svg3-property svg3-property-community">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">SVGMapコミュニティ</p>
        <h2 class="svg3-property-title">${escapeHtml(title)}</h2>
      </header>
      <dl class="svg3-property-body">${rows}</dl>
    </article>`,
    attribution: { label: 'SVGMap community' },
  };
};

export const communityPropertyTransformForLayer = (layer = {}) => {
  const title = String(layer.title || layer.label || layer.attrs?.title || '');
  const href = String(layer.attrs?.['xlink:href'] || layer.sourceUrl || '');
  if (/USGS/i.test(title) && /(地震|earthquake)/i.test(title + href)) return usgsEarthquakeProperty;

  let sourceUrl = safeHttpUrl(layer.sourceUrl || href.split('#')[0]);
  const publisher = String(layer.community?.publisher || '').trim();
  let hostname = '';
  try { hostname = new URL(sourceUrl).hostname; } catch {}
  const attribution = {
    label: publisher || hostname || '追加レイヤー',
    ...(sourceUrl ? { url: sourceUrl } : {}),
  };
  return (record, target) => ({
    ...genericCommunityProperty(record, target),
    attribution,
  });
};

export const usgsEarthquakeProperty = (record) => {
  const magnitude = record.mag ? `M ${record.mag}${record.magType ? ` (${record.magType})` : ''}` : '規模不明';
  const place = record.place || '震源地不明';
  const eventId = /^[a-z0-9_-]+$/i.test(String(record.id || '')) ? record.id : '';
  const detailUrl = eventId
    ? safeHttpUrl(`https://earthquake.usgs.gov/earthquakes/eventpage/${eventId}/executive`)
    : '';
  const link = detailUrl
    ? `<div class="svg3-property-actions"><a class="svg3-property-link" href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer">USGSで詳細を見る</a></div>`
    : '';
  const rows = [
    rowMarkup('マグニチュード', magnitude),
    rowMarkup('深さ', record.depth ? `${record.depth} km` : ''),
    rowMarkup('発生時刻', dateTimeLabel(record.time)),
    rowMarkup('更新時刻', dateTimeLabel(record.updated)),
    rowMarkup('場所', place),
    rowMarkup('座標', record.latitude && record.longitude ? `${record.latitude}, ${record.longitude}` : ''),
    rowMarkup('種別', record.type),
    rowMarkup('審査状態', record.status),
  ].join('');
  return {
    html: `<article class="svg3-property svg3-property-earthquake">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">地震情報</p>
        <h2 class="svg3-property-title">${escapeHtml(place)}</h2>
        <p class="svg3-property-status"><span class="svg3-property-dot"></span>${escapeHtml(magnitude)}</p>
      </header>
      <dl class="svg3-property-body">${rows}${link}</dl>
    </article>`,
    attribution: {
      label: 'U.S. Geological Survey — Earthquake Hazards Program',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/csv.php',
    },
  };
};

export const registerCommunityPropertyAdapter = ({
  svgMap = window.svgMap,
  layerId = window.layerID,
  transform = genericCommunityProperty,
} = {}) => {
  if (!svgMap?.setShowPoiProperty || !layerId) return false;

  installCommunityPropertyRegistrationMonitor(svgMap);

  const state = getPropertyRegistrationState(svgMap);
  const id = String(layerId);
  const current = state.registrations.get(id);

  // Preserve SVGMap/community semantics. If the layer/controller has registered
  // its own handler (including an explicit null registration), SVG3 must not
  // replace it with the host generic formatter.
  if (hasNativePropertyRegistration(svgMap, id)) return false;

  // Avoid repeatedly registering the same class of fallback during the
  // 0/300/900/2200 ms readiness retries.
  if (current?.owner === 'svg3-fallback') return false;

  let lastInfo = null;
  const show = (target) => {
    const record = communityRecordFromTarget(target, svgMap);
    const view = transform(record, target) || genericCommunityProperty(record, target);
    lastInfo = showPropertyModal(view.html, { attribution: view.attribution });
    return lastInfo;
  };

  state.fallbackHandlers.add(show);
  svgMap.setShowPoiProperty(show, id);

  // A small host-side bridge also lets controller tools invoke the exact same
  // formatter without duplicating the conversion contract.
  const bridge = Object.freeze({
    layerId: id,
    show,
    get lastInfo() { return lastInfo; },
  });
  window.svg3CommunityPropertyAdapters ||= Object.create(null);
  window.svg3CommunityPropertyAdapters[id] = bridge;
  window.svg3CommunityPropertyAdapter = bridge;
  return true;
};
