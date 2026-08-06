const STORAGE_KEY = 'svg3.nativeImportedLayers.v1';

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

// 管理者が同梱したsvgmapAppLayersのカタログから、1レイヤーだけを現在の地図へ追加する。
// 任意URLのインポートとは異なり、コードは既にこの配布物に含まれるため、本家と同じ
// controller実行ができるtightモードを許可する。対象は固定の同一オリジン配下に限る。
export const importBundledCommunityLayer = (entry, {
  containerUrl = '/map/svgMapAppLayers/Container.svg',
  configuration = {},
} = {}) => {
  if (!entry?.animation?.['xlink:href']) throw new Error('コミュニティレイヤー定義が不完全です');
  if (entry.status === 'incompatible') throw new Error('現在の構成では追加できません');

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
  const configuredHref = new URL(entry.adapterHref || sourceAttrs['xlink:href'], sourceUrl);
  for (const field of entry.configuration?.fields || []) {
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
    const hash = new URLSearchParams(configuredHref.hash.replace(/^#/, ''));
    hash.set(field.name, endpoint.href);
    configuredHref.hash = hash.toString();
  }
  attrs['xlink:href'] = safeUrl(configuredHref.href, sourceUrl);
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
    group: 'SVGMapコミュニティ',
    community: {
      publisher: 'SVGMap community',
      license: { name: 'Mozilla Public License 2.0', spdx: 'MPL-2.0' },
      status: entry.status || 'unverified',
      category: entry.category || '—',
      runtime: 'tight',
      delivery: entry.delivery || 'bundled-community',
      offline: Boolean(entry.offline),
      externalDependencies: entry.externalDependencies || [],
      verifiedAt: entry.verifiedAt || null,
      reason: entry.reason || '管理者が同梱したSVGMapコミュニティ資産',
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
    return Array.isArray(value)
      ? value.filter(isStoredLayer).map((layer) => ({
          ...layer,
          title: layer.title || layer.label,
          label: layer.label || layer.title,
        }))
      : [];
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
