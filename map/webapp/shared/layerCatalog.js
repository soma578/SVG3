export const normalizeCatalogLayer = (layer) => ({
  ...layer,
  id: layer.id,
  title: layer.label || layer.id,
  className: layer.className || '',
  visible: layer.visible !== false,
  mounts: Array.isArray(layer.mounts) && layer.mounts.length > 0 ? layer.mounts : [layer.id],
  toggleKey: layer.toggleKey || layer.id,
});

export const parseContainerLayers = (source, parseXml = (text) => (
  new DOMParser().parseFromString(text, 'image/svg+xml')
)) => {
  const documentXml = parseXml(source);
  return Array.from(documentXml.querySelectorAll('animation'))
    .map((animation, index) => ({
      id: animation.getAttribute('id') || `layer-${index + 1}`,
      title: animation.getAttribute('title') || animation.getAttribute('id') || `レイヤー ${index + 1}`,
      className: animation.getAttribute('class') || '',
      visible: animation.getAttribute('visibility') !== 'hidden',
      mounts: [animation.getAttribute('id') || `layer-${index + 1}`],
      toggleKey: animation.getAttribute('id') || `layer-${index + 1}`,
    }))
    .filter((layer) => !/detail|base-area/.test(layer.id));
};

// 周辺地域レイヤーは県ごとに違うので、全国共通の catalog.json ではなく
// /map/regions/<id>/neighbor-catalog.json に分かれている。取得できなくても
// 本体のカタログだけで地図は成立させる（隣県が出ないだけにする）。
export const neighborCatalogUrl = (regionId) => (
  regionId ? `/map/regions/${encodeURIComponent(regionId)}/neighbor-catalog.json` : ''
);

export const loadLayerCatalog = async ({
  containerUrl,
  catalogUrl = '/map/layers/catalog.json',
  supplementUrl = '',
  fetchImpl = fetch,
  parseXml,
}) => {
  const fetchJson = (url) => fetchImpl(url)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const [catalog, supplement] = await Promise.all([
    fetchJson(catalogUrl),
    supplementUrl ? fetchJson(supplementUrl) : Promise.resolve(null),
  ]);
  if (Array.isArray(catalog?.layers)) {
    const layers = [
      ...catalog.layers,
      ...(Array.isArray(supplement?.layers) ? supplement.layers : []),
    ]
      .filter((layer) => layer.userToggle !== false)
      .map(normalizeCatalogLayer);
    return {
      source: 'catalog',
      layers,
      presets: Array.isArray(catalog.presets) ? catalog.presets : [],
      neighbors: Array.isArray(supplement?.neighbors) ? supplement.neighbors : [],
    };
  }

  const response = await fetchImpl(containerUrl);
  if (!response.ok) throw new Error(`${response.status} ${containerUrl}`);
  return {
    source: 'container-fallback',
    layers: parseContainerLayers(await response.text(), parseXml),
    presets: [],
    neighbors: [],
  };
};
