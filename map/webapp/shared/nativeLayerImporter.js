const STORAGE_KEY = 'svg3.nativeImportedLayers.v1';
const SVGMAP_APP_LAYERS_UPSTREAM_CONTAINER = 'https://svgmap.github.io/svgmapAppLayers/Container.svg';

const SAFE_ATTRIBUTES = new Set([
  'id',
  'x',
  'y',
  'width',
  'height',
  'title',
  'class',
  'visibility',
  'opacity',
  'preserveAspectRatio',
]);

const SAFE_DATA_ATTRIBUTES = new Set([
  'data-controller',
  'data-cross-origin-proxy-required',
]);

const safeUrl = (value, baseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('レイヤーURLがありません');
  const hashIndex = raw.indexOf('#');
  const path = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
  const url = new URL(path || baseUrl, baseUrl);
  if (!['http:', 'https:', 'blob:'].includes(url.protocol)) {
    throw new Error(`未対応のURL形式です: ${url.protocol}`);
  }
  return `${url.href}${hash}`;
};

const safeControllerUrl = (value, baseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return safeUrl(raw, baseUrl);
};

const slugify = (value) => {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'layer';
};

const uniqueId = (title, index) => {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || `${Date.now().toString(36)}-${index + 1}`;
  return `layer-imported-${slugify(title)}-${suffix}`;
};

export const sanitizeRuntimeAnimation = (animation, sourceUrl, index, options = {}) => {
  const rawHref = animation.getAttribute('xlink:href') || animation.getAttribute('href');
  if (!rawHref) return null;
  const title = animation.getAttribute('title') || `外部レイヤー ${index + 1}`;
  const attrs = {};
  for (const attr of animation.attributes) {
    if (SAFE_ATTRIBUTES.has(attr.name) || SAFE_DATA_ATTRIBUTES.has(attr.name)) {
      attrs[attr.name] = attr.value;
    }
  }
  if (attrs['data-controller']) {
    attrs['data-controller'] = safeControllerUrl(attrs['data-controller'], sourceUrl);
  }
  attrs.id = uniqueId(title, index);
  attrs['xlink:href'] = safeUrl(rawHref, sourceUrl);
  attrs.title = title;
  attrs.class = attrs.class || 'vectorEtcData';
  attrs.visibility = options.initialVisibility === 'visible' ? 'visible' : 'hidden';
  attrs.opacity = attrs.opacity || '1';
  const verifiedLocalTight = options.lawaMode === 'tight' && options.sourceType === 'verified-artifact';
  attrs['data-lawa-mode'] = verifiedLocalTight ? 'tight' : 'isolated';
  attrs['data-external-source'] = options.sourceType || 'runtime';
  const signed = options.sourceType === 'signed-artifact';
  const verified = options.sourceType === 'verified-artifact';
  return {
    id: attrs.id,
    title,
    label: title,
    className: attrs.class,
    visible: attrs.visibility === 'visible',
    imported: true,
    group: signed || verified ? 'SVGMapコミュニティ' : '互換性未確認',
    community: {
      publisher: options.publisher || (signed ? '署名済み発行者' : verified ? 'この配布物' : '未確認'),
      license: options.license || null,
      status: signed ? 'signed' : verified ? 'supported' : 'unverified',
      category: options.category || '—',
      runtime: attrs['data-lawa-mode'],
      delivery: options.sourceType || 'runtime-url',
      offline: Boolean(options.offline),
      externalDependencies: options.externalDependencies || [],
      verifiedAt: options.verifiedAt || null,
      reason: signed
        ? '信頼済み発行者の署名を検証した配布物'
        : verified
          ? 'このサイトで検証済みの配布物'
          : '利用者がURLから直接追加した未検証レイヤ',
    },
    sourceUrl,
    attrs,
  };
};

const assertXml = (documentXml) => {
  const error = documentXml.querySelector('parsererror');
  if (error) throw new Error('Container.svgをXMLとして解析できません');
};

export const importContainerText = (text, sourceUrl, options = {}) => {
  const resolvedSource = safeUrl(sourceUrl, location.href);
  const documentXml = new DOMParser().parseFromString(text, 'image/svg+xml');
  assertXml(documentXml);
  const layers = Array.from(documentXml.querySelectorAll('animation'))
    .map((animation, index) => sanitizeRuntimeAnimation(animation, resolvedSource, index, options))
    .filter(Boolean);
  if (layers.length === 0) throw new Error('animationレイヤーが見つかりません');
  return layers;
};

export const importSingleLayer = ({ url, title }) => {
  const href = safeUrl(url, location.href);
  const fallbackTitle = href.startsWith('blob:')
    ? 'ローカルレイヤー'
    : decodeURIComponent(new URL(href).pathname.split('/').pop() || '外部レイヤー');
  const layerTitle = String(title || '').trim() || fallbackTitle;
  const id = uniqueId(layerTitle, 0);
  return {
    id,
    title: layerTitle,
    label: layerTitle,
    className: 'vectorEtcData',
    visible: true,
    imported: true,
    group: '互換性未確認',
    community: {
      publisher: '未確認',
      license: null,
      status: 'unverified',
      category: '—',
      runtime: 'isolated',
      delivery: 'runtime-url',
      offline: false,
      externalDependencies: [new URL(href).hostname].filter(Boolean),
      verifiedAt: null,
      reason: '利用者がURLから直接追加した未検証レイヤ',
    },
    sourceUrl: href,
    attrs: {
      id,
      x: '12243.4',
      y: '-4605.6',
      width: '3205.3',
      height: '2251.0',
      'xlink:href': href,
      title: layerTitle,
      class: 'vectorEtcData',
      visibility: 'visible',
      opacity: '1',
      'data-lawa-mode': 'isolated',
      'data-external-source': 'runtime',
    },
  };
};

const comparableUrl = (value, baseUrl) => {
  try {
    const url = new URL(String(value || ''), baseUrl);
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
};

// 利用者が本家のURLを貼った場合も、同梱済みの検証済みアダプターへ案内する。
// WebAppレイヤーか単純SVGかを利用者に判断させないための対応表である。
export const findBundledCommunityEntry = (entries, inputUrl, {
  localContainerUrl = '/map/svgMapAppLayers/Container.svg',
  upstreamContainerUrl = SVGMAP_APP_LAYERS_UPSTREAM_CONTAINER,
} = {}) => {
  const requested = comparableUrl(inputUrl, location.href);
  if (!requested) return null;
  const localContainer = new URL(localContainerUrl, location.href).href;
  return (Array.isArray(entries) ? entries : []).find((entry) => {
    const original = entry.href || entry.animation?.['xlink:href'] || '';
    const local = entry.adapterHref || entry.animation?.['xlink:href'] || entry.href || '';
    return requested === comparableUrl(original, upstreamContainerUrl)
      || requested === comparableUrl(local, localContainer);
  }) || null;
};

// 管理者が同梱したsvgmapAppLayersのカタログから、1レイヤーだけを現在の地図へ追加する。
// 任意URLのインポートとは異なり、コードは既にこの配布物に含まれるため、本家と同じ
// controller実行ができるtightモードを許可する。対象は固定の同一オリジン配下に限る。
export const importBundledCommunityLayer = (entry, {
  containerUrl = '/map/svgMapAppLayers/Container.svg',
  configuration = {},
} = {}) => {
  if (!entry?.animation?.['xlink:href']) throw new Error('コミュニティレイヤー定義が不完全です');
  // 追加できないのは配布物に実体が無いときだけ。互換性の等級では止めない。
  if (entry.available === false) {
    throw new Error(entry.unavailableReason || '配布物にレイヤーの実体がありません');
  }

  const resolvedContainer = new URL(containerUrl, location.href);
  if (resolvedContainer.origin !== location.origin || resolvedContainer.pathname !== '/map/svgMapAppLayers/Container.svg') {
    throw new Error('管理者同梱のコミュニティContainerだけを追加できます');
  }
  const sourceUrl = resolvedContainer.href;
  const sourceAttrs = entry.animation;
  const title = entry.title || sourceAttrs.title || 'SVGMapコミュニティレイヤー';
  const id = uniqueId(title, Number(entry.sourceIndex || 1) - 1);
  const attrs = {};
  for (const [name, value] of Object.entries(sourceAttrs)) {
    if (SAFE_ATTRIBUTES.has(name) || SAFE_DATA_ATTRIBUTES.has(name)) attrs[name] = String(value);
  }
  Object.assign(attrs, entry.placement || {});
  attrs.id = id;
  // 旧AppLayersには #csvPath=https://... のように、生のURLをfragmentへ入れ、
  // 自前で split("&") するレイヤーがある。URL.hrefへ一度通すと :// が
  // percent-encodeされ、旧ローダーが相対パスと誤認するため、設定不要なら
  // safeUrlが保持したfragment文字列をそのまま使う。
  // The legacy USGS all-week CSV layer depends on an old isolated CSV
  // controller that does not reliably repaint in the current runtime. Serve
  // the same all-week/all-magnitude feed through the verified GeoJSON adapter.
  const legacyUsgsAllWeek = Number(entry.sourceIndex) === 88
    && title === '地震 ALL 過去1週間(USGS)';
  const rawConfiguredHref = legacyUsgsAllWeek
    ? '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes-all-week.svg'
    : (entry.adapterHref || sourceAttrs['xlink:href']);
  let configuredHref = safeUrl(rawConfiguredHref, sourceUrl);
  const configurationFields = entry.configuration?.fields || [];
  const configuredHash = configurationFields.length > 0
    ? new URLSearchParams(configuredHref.split('#')[1] || '')
    : null;
  for (const field of configurationFields) {
    const raw = String(configuration[field.name] || '').trim();
    if (!raw && field.required) throw new Error(`${field.label}を入力してください`);
    if (!raw) continue;
    let endpoint;
    try {
      endpoint = new URL(raw);
    } catch {
      throw new Error(`${field.label}のURLが正しくありません`);
    }
    if (!(field.protocols || ['https:']).includes(endpoint.protocol)) {
      throw new Error(`${field.label}はHTTPS URLを指定してください`);
    }
    configuredHash.set(field.name, endpoint.href);
  }
  if (configuredHash) {
    configuredHref = `${configuredHref.split('#')[0]}#${configuredHash.toString()}`;
  }
  attrs['xlink:href'] = configuredHref;
  attrs.title = title;
  attrs.class = attrs.class || 'vectorEtcData';
  attrs.visibility = 'visible';
  attrs.opacity = attrs.opacity || '1';
  if (entry.controllerHref || attrs['data-controller']) {
    attrs['data-controller'] = safeControllerUrl(entry.controllerHref || attrs['data-controller'], sourceUrl);
  }
  attrs['data-lawa-mode'] = 'tight';
  attrs['data-external-source'] = 'bundled-community';

  return {
    id,
    title,
    label: title,
    className: attrs.class,
    visible: true,
    imported: true,
    // Container 側またはレイヤー SVG 自身で controller が宣言されている
    // コミュニティレイヤーにも、ネイティブのレイヤーパネルから開ける入口を出す。
    // controller URL は SVGMap がレイヤー読込み時に解決するため、ここでは存在情報だけを使う。
    ...(entry.controller ? { controllerUi: { label: '設定' } } : {}),
    group: 'SVGMapコミュニティ',
    community: {
      publisher: 'SVGMap community',
      license: { name: 'Mozilla Public License 2.0', spdx: 'MPL-2.0' },
      // status は「どこから来たか」だけを表す。互換性の等級ではない。
      status: 'bundled',
      runtime: 'tight',
      delivery: entry.delivery || 'bundled',
      offline: Boolean(entry.offline),
      externalDependencies: entry.externalDependencies || [],
      verifiedAt: entry.verifiedAt || null,
      reason: entry.note || '管理者が同梱したSVGMapコミュニティ資産',
    },
    sourceUrl,
    attrs,
  };
};

export const importLocalLayerFile = (file, title) => {
  if (!file) throw new Error('SVG / HTML ファイルを選択してください');
  if (!/\.(svg|html?)$/i.test(file.name || '')) {
    throw new Error('追加できるローカルファイルは .svg / .html です');
  }
  const href = URL.createObjectURL(file);
  const fallbackTitle = (file.name || 'ローカルレイヤー').replace(/\.(svg|html?)$/i, '');
  const layer = {
    ...importSingleLayer({ url: href, title: title || fallbackTitle }),
    sourceUrl: href,
    transient: true,
    localFileName: file.name || '',
  };
  layer.group = 'ローカルレイヤー';
  layer.community = {
    ...layer.community,
    publisher: 'この端末',
    status: 'local',
    delivery: 'local-file',
    externalDependencies: [],
    reason: 'このブラウザで選択した一時ファイル。他の利用者とは共有されません',
  };
  return layer;
};

const isStoredLayer = (layer) =>
  layer
  && typeof layer.id === 'string'
  && layer.id.startsWith('layer-imported-')
  && (typeof layer.title === 'string' || typeof layer.label === 'string')
  && layer.attrs
  && typeof layer.attrs['xlink:href'] === 'string'
  && !layer.transient
  && /^https?:\/\//i.test(layer.attrs['xlink:href']);

export const loadImportedLayers = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const layers = Array.isArray(value)
      ? value.filter(isStoredLayer).map((layer) => ({
          ...layer,
          title: layer.title || layer.label,
          label: layer.label || layer.title,
        }))
      : [];
    let migrated = false;
    for (const layer of layers) {
      const href = layer.attrs?.['xlink:href'] || '';
      if (layer.title === '地震 ALL 過去1週間(USGS)' && href.includes('all_week.csv')) {
        layer.attrs['xlink:href'] = new URL(
          '/map/layers/external/svgmap-app-layers/adapters/usgs-earthquakes-all-week.svg',
          location.href,
        ).href;
        if (layer.community) layer.community.runtime = 'tight';
        migrated = true;
      }
    }
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(layers));
    return layers;
  } catch {
    return [];
  }
};

export const saveImportedLayers = (layers) => {
  const imported = layers.filter((layer) => layer.imported && isStoredLayer(layer));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
  } catch (error) {
    console.warn('[nativeLayerImporter] imported layers could not be saved', error);
  }
};
