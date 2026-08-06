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

export const loadLayerCatalog = async ({
  containerUrl,
  catalogUrl = '/map/layers/catalog.json',
  fetchImpl = fetch,
  parseXml,
}) => {
  const catalog = await fetchImpl(catalogUrl)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (Array.isArray(catalog?.layers)) {
    const layers = catalog.layers
      .filter((layer) => layer.userToggle !== false)
      .map(normalizeCatalogLayer);
    return {
      source: 'catalog',
      layers,
      presets: Array.isArray(catalog.presets) ? catalog.presets : [],
    };
  }

  const response = await fetchImpl(containerUrl);
  if (!response.ok) throw new Error(`${response.status} ${containerUrl}`);
  return {
    source: 'container-fallback',
    layers: parseContainerLayers(await response.text(), parseXml),
    presets: [],
  };
};
