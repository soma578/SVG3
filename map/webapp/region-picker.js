const SVG_NS = 'http://www.w3.org/2000/svg';

const elements = {
  search: document.getElementById('region-search'),
  map: document.getElementById('japan-map'),
  paths: document.getElementById('prefecture-paths'),
  label: document.getElementById('map-label'),
  loading: document.getElementById('loading'),
  list: document.getElementById('region-list'),
  count: document.getElementById('region-count'),
  empty: document.getElementById('empty-state'),
  back: document.getElementById('back-button'),
  scopeLabel: document.getElementById('scope-label'),
  eyebrow: document.getElementById('panel-eyebrow'),
  heading: document.getElementById('region-heading'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  resetView: document.getElementById('reset-view'),
  panelToggle: document.getElementById('panel-toggle'),
};

const state = {
  regions: [],
  items: [],
  mode: 'prefecture',
  region: null,
  pathsByItemId: new Map(),
  buttonByItemId: new Map(),
  activeItemId: '',
  renderId: 0,
  homeViewBox: null,
  viewBox: null,
  pointers: new Map(),
  gesture: null,
  suppressClickUntil: 0,
};

const fetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
};

const fetchJson = async (url) => JSON.parse(await fetchText(url));

const parseGlobalViewBox = (source) => {
  const values = String(source || '').split(',');
  if (values[0] !== 'global') throw new Error(`invalid global viewBox: ${source}`);
  const [minLon, minLat, lonSpan, latSpan] = values.slice(1).map(Number);
  if (![minLon, minLat, lonSpan, latSpan].every(Number.isFinite)) {
    throw new Error(`invalid global viewBox: ${source}`);
  }
  return { minLon, minLat, lonSpan, latSpan };
};

const setViewBox = (viewBox) => {
  state.viewBox = viewBox;
  elements.map.setAttribute(
    'viewBox',
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
  );
};

const clampViewBox = (viewBox) => {
  const home = state.homeViewBox;
  if (!home) return viewBox;
  const minScale = 0.08;
  const width = Math.min(home.width, Math.max(home.width * minScale, viewBox.width));
  const height = Math.min(home.height, Math.max(home.height * minScale, viewBox.height));
  return {
    x: Math.min(home.x + home.width - width, Math.max(home.x, viewBox.x)),
    y: Math.min(home.y + home.height - height, Math.max(home.y, viewBox.y)),
    width,
    height,
  };
};

const renderedMapRect = (viewBox = state.viewBox) => {
  const rect = elements.map.getBoundingClientRect();
  if (!viewBox || rect.width <= 0 || rect.height <= 0) return rect;
  const viewAspect = viewBox.width / viewBox.height;
  const rectAspect = rect.width / rect.height;
  if (rectAspect > viewAspect) {
    const width = rect.height * viewAspect;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top,
      width,
      height: rect.height,
    };
  }
  const height = rect.width / viewAspect;
  return {
    left: rect.left,
    top: rect.top + (rect.height - height) / 2,
    width: rect.width,
    height,
  };
};

const relativePoint = (clientX, clientY, viewBox = state.viewBox) => {
  const rect = renderedMapRect(viewBox);
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
};

const zoomView = (factor, clientX = null, clientY = null, sourceView = state.viewBox) => {
  if (!sourceView || !state.homeViewBox) return;
  const point = clientX == null || clientY == null
    ? { x: 0.5, y: 0.5 }
    : relativePoint(clientX, clientY, sourceView);
  const next = clampViewBox({
    x: sourceView.x + sourceView.width * point.x - sourceView.width * factor * point.x,
    y: sourceView.y + sourceView.height * point.y - sourceView.height * factor * point.y,
    width: sourceView.width * factor,
    height: sourceView.height * factor,
  });
  setViewBox(next);
};

const resetMapView = () => {
  if (state.homeViewBox) setViewBox({ ...state.homeViewBox });
};

const pointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pointerCenter = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const beginGesture = () => {
  const pointers = [...state.pointers.values()];
  if (pointers.length >= 2) {
    const center = pointerCenter(pointers[0], pointers[1]);
    state.gesture = {
      kind: 'pinch',
      distance: pointerDistance(pointers[0], pointers[1]),
      center,
      point: relativePoint(center.x, center.y),
      viewBox: { ...state.viewBox },
    };
    return;
  }
  if (pointers.length === 1) {
    state.gesture = {
      kind: 'pan',
      pointer: { ...pointers[0] },
      viewBox: { ...state.viewBox },
    };
    return;
  }
  state.gesture = null;
};

const handlePointerMove = (event) => {
  if (!state.pointers.has(event.pointerId) || !state.gesture) return;
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const pointers = [...state.pointers.values()];
  if (state.gesture.kind === 'pinch' && pointers.length >= 2) {
    const distance = pointerDistance(pointers[0], pointers[1]);
    if (distance <= 0) return;
    const factor = state.gesture.distance / distance;
    const source = state.gesture.viewBox;
    const point = state.gesture.point;
    setViewBox(clampViewBox({
      x: source.x + source.width * point.x - source.width * factor * point.x,
      y: source.y + source.height * point.y - source.height * factor * point.y,
      width: source.width * factor,
      height: source.height * factor,
    }));
    state.suppressClickUntil = Date.now() + 300;
    return;
  }
  if (state.gesture.kind === 'pan' && pointers.length === 1) {
    const pointer = pointers[0];
    const dx = pointer.x - state.gesture.pointer.x;
    const dy = pointer.y - state.gesture.pointer.y;
    if (Math.hypot(dx, dy) < 3) return;
    const rect = renderedMapRect(state.gesture.viewBox);
    const source = state.gesture.viewBox;
    setViewBox(clampViewBox({
      x: source.x - (dx / rect.width) * source.width,
      y: source.y - (dy / rect.height) * source.height,
      width: source.width,
      height: source.height,
    }));
    state.suppressClickUntil = Date.now() + 300;
  }
};

const releasePointer = (event) => {
  state.pointers.delete(event.pointerId);
  if (event.target.hasPointerCapture?.(event.pointerId)) {
    event.target.releasePointerCapture(event.pointerId);
  }
  beginGesture();
  elements.map.classList.toggle('dragging', state.pointers.size > 0);
};

const nativeMapUrl = (municipalityId) => {
  const url = new URL('./native-map.html', location.href);
  url.searchParams.set('regionId', state.region.id);
  url.searchParams.set('municipalityId', municipalityId);
  return url.href;
};

const appendPathForItem = (itemId, path) => {
  const paths = state.pathsByItemId.get(itemId) || [];
  paths.push(path);
  state.pathsByItemId.set(itemId, paths);
};

const setActiveItem = (itemId = '') => {
  if (state.activeItemId === itemId) return;
  for (const path of state.pathsByItemId.get(state.activeItemId) || []) {
    path.classList.remove('active');
  }
  state.buttonByItemId.get(state.activeItemId)?.classList.remove('active');
  state.activeItemId = itemId;
  for (const path of state.pathsByItemId.get(itemId) || []) {
    path.classList.add('active');
  }
  state.buttonByItemId.get(itemId)?.classList.add('active');
  const item = state.items.find((entry) => entry.id === itemId);
  elements.label.textContent = item?.label || state.region?.label || '全国';
};

const openItem = async (item) => {
  if (Date.now() < state.suppressClickUntil) return;
  if (item.dataStatus === 'empty') return;
  if (state.mode === 'prefecture') {
    const next = new URL(location.href);
    next.search = '';
    next.searchParams.set('regionId', item.id);
    history.pushState(null, '', next);
    await renderCurrentScope();
    return;
  }
  location.href = nativeMapUrl(item.id);
};

const createMapPath = (sourcePath, item) => {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', sourcePath.getAttribute('d') || '');
  path.setAttribute('class', 'pref-path');
  path.setAttribute('tabindex', item.dataStatus === 'empty' ? '-1' : '0');
  path.setAttribute('role', 'button');
  path.setAttribute('aria-label', item.label);
  path.setAttribute('aria-disabled', String(item.dataStatus === 'empty'));
  path.dataset.itemId = item.id;
  path.classList.toggle('unavailable', item.dataStatus === 'empty');
  const activate = () => setActiveItem(item.id);
  path.addEventListener('pointerenter', activate);
  path.addEventListener('focus', activate);
  path.addEventListener('pointerleave', () => setActiveItem(''));
  path.addEventListener('blur', () => setActiveItem(''));
  path.addEventListener('click', () => void openItem(item));
  path.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void openItem(item);
  });
  appendPathForItem(item.id, path);
  return path;
};

const itemMeta = (item) => {
  if (state.mode === 'municipality') {
    return `避難所 ${Number(item.shelterCount) || 0}件`;
  }
  return `避難所 ${Number(item.summary?.evacuationCount) || 0}件`;
};

const createItemButton = (item) => {
  const listItem = document.createElement('li');
  const button = document.createElement('button');
  const code = document.createElement('span');
  const copy = document.createElement('span');
  const name = document.createElement('span');
  const meta = document.createElement('small');
  button.type = 'button';
  button.className = 'region-button';
  button.classList.toggle('municipality', state.mode === 'municipality');
  button.disabled = item.dataStatus === 'empty';
  button.dataset.itemId = item.id;
  code.className = 'pref-code';
  code.textContent = item.prefCode || '';
  copy.className = 'region-copy';
  name.className = 'region-name';
  name.textContent = item.label || item.prefecture || item.id;
  meta.className = 'region-meta';
  meta.textContent = itemMeta(item);
  copy.append(name, meta);
  // 都道府県番号は全国一覧の視認性に使うが、市区町村コードは
  // 利用者向けの名称ではない。内部の検索・対応には保持し、一覧には出さない。
  if (state.mode === 'prefecture') button.append(code);
  button.append(copy);
  button.addEventListener('pointerenter', () => setActiveItem(item.id));
  button.addEventListener('focus', () => setActiveItem(item.id));
  button.addEventListener('pointerleave', () => setActiveItem(''));
  button.addEventListener('blur', () => setActiveItem(''));
  button.addEventListener('click', () => void openItem(item));
  listItem.append(button);
  state.buttonByItemId.set(item.id, button);
  return listItem;
};

const applyFilter = () => {
  const query = elements.search.value.trim().toLocaleLowerCase('ja');
  let visible = 0;
  for (const item of state.items) {
    const label = [
      item.label,
      item.prefecture,
      item.id,
      item.displayCode,
      ...(item.municipalityCodes || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase('ja');
    const matches = !query || label.includes(query);
    state.buttonByItemId.get(item.id)?.closest('li')?.toggleAttribute('hidden', !matches);
    for (const path of state.pathsByItemId.get(item.id) || []) {
      path.classList.toggle('filtered', !matches);
    }
    if (matches) visible += 1;
  }
  elements.count.textContent = String(visible);
  elements.empty.hidden = visible > 0;
};

const renderPaths = (svgSource, itemByCode, codeAttribute) => {
  const source = new DOMParser().parseFromString(svgSource, 'image/svg+xml');
  const root = source.documentElement;
  const viewBox = parseGlobalViewBox(root.getAttribute('viewBox'));
  state.homeViewBox = {
    x: viewBox.minLon,
    y: 0,
    width: viewBox.lonSpan,
    height: viewBox.latSpan,
  };
  resetMapView();
  elements.paths.setAttribute(
    'transform',
    `matrix(1 0 0 -1 0 ${viewBox.minLat + viewBox.latSpan})`,
  );
  const paths = [];
  for (const sourcePath of source.querySelectorAll(`path[${codeAttribute}]`)) {
    const item = itemByCode.get(sourcePath.getAttribute(codeAttribute) || '');
    if (item) paths.push(createMapPath(sourcePath, item));
  }
  elements.paths.replaceChildren(...paths);
};

const resetRenderState = () => {
  state.pathsByItemId.clear();
  state.buttonByItemId.clear();
  state.activeItemId = '';
  elements.search.value = '';
  elements.empty.hidden = true;
  elements.loading.hidden = false;
  document.body.classList.remove('panel-collapsed');
  elements.panelToggle.setAttribute('aria-expanded', 'true');
  elements.panelToggle.setAttribute('aria-label', '一覧を折りたたむ');
  elements.panelToggle.title = '一覧を折りたたむ';
};

const renderPrefectures = async (renderId) => {
  state.mode = 'prefecture';
  state.region = null;
  state.items = state.regions;
  elements.scopeLabel.textContent = '全国';
  elements.eyebrow.textContent = 'JAPAN';
  elements.heading.textContent = '都道府県';
  elements.search.placeholder = '都道府県を検索';
  elements.back.hidden = true;
  const svgSource = await fetchText('/map/layers/overview/japan.svg');
  if (renderId !== state.renderId) return;
  const itemByCode = new Map(
    state.items.map((item) => [String(item.prefCode || '').padStart(2, '0'), item]),
  );
  renderPaths(svgSource, itemByCode, 'data-pref-code');
};

const renderMunicipalities = async (region, renderId) => {
  state.mode = 'municipality';
  state.region = region;
  const [index, svgSource] = await Promise.all([
    fetchJson(`/map/regions/${encodeURIComponent(region.id)}/municipalities.json`),
    fetchText(`/map/layers/overview/pref/${encodeURIComponent(region.prefCode)}.svg`),
  ]);
  if (renderId !== state.renderId) return;
  state.items = index.municipalities || [];
  elements.scopeLabel.textContent = region.label;
  elements.eyebrow.textContent = region.label;
  elements.heading.textContent = '市区町村';
  elements.search.placeholder = '市区町村を検索';
  elements.back.hidden = false;
  const itemByCode = new Map();
  for (const item of state.items) {
    for (const code of item.municipalityCodes || []) itemByCode.set(String(code), item);
  }
  renderPaths(svgSource, itemByCode, 'data-n03-code');
};

const renderCurrentScope = async () => {
  const renderId = ++state.renderId;
  resetRenderState();
  try {
    const regionId = new URLSearchParams(location.search).get('regionId') || '';
    const region = state.regions.find((entry) => entry.id === regionId) || null;
    if (region) await renderMunicipalities(region, renderId);
    else await renderPrefectures(renderId);
    if (renderId !== state.renderId) return;
    elements.list.replaceChildren(...state.items.map(createItemButton));
    elements.count.textContent = String(state.items.length);
    elements.label.textContent = state.region?.label || '全国';
    elements.loading.hidden = true;
    elements.search.focus();
  } catch (error) {
    console.error('[region-picker] render failed', error);
    elements.loading.textContent = '地域データを読み込めませんでした';
  }
};

const showNationwide = () => {
  const next = new URL(location.href);
  next.search = '';
  history.pushState(null, '', next);
  void renderCurrentScope();
};

const toggleMobilePanel = () => {
  const collapsed = document.body.classList.toggle('panel-collapsed');
  elements.panelToggle.setAttribute('aria-expanded', String(!collapsed));
  elements.panelToggle.setAttribute(
    'aria-label',
    collapsed ? '一覧を開く' : '一覧を折りたたむ',
  );
  elements.panelToggle.title = collapsed ? '一覧を開く' : '一覧を折りたたむ';
};

const start = async () => {
  try {
    const regionIndex = await fetchJson('/map/regions/index.json');
    state.regions = regionIndex.regions || [];
    await renderCurrentScope();
  } catch (error) {
    console.error('[region-picker] startup failed', error);
    elements.loading.textContent = '地域データを読み込めませんでした';
  }
};

elements.search.addEventListener('input', applyFilter);
elements.back.addEventListener('click', showNationwide);
elements.zoomIn.addEventListener('click', () => zoomView(0.75));
elements.zoomOut.addEventListener('click', () => zoomView(1.25));
elements.resetView.addEventListener('click', resetMapView);
elements.panelToggle.addEventListener('click', toggleMobilePanel);
elements.map.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomView(event.deltaY > 0 ? 1.16 : 0.86, event.clientX, event.clientY);
}, { passive: false });
elements.map.addEventListener('dblclick', (event) => {
  event.preventDefault();
  zoomView(0.68, event.clientX, event.clientY);
});
elements.map.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  event.target.setPointerCapture?.(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  beginGesture();
  elements.map.classList.add('dragging');
});
elements.map.addEventListener('pointermove', handlePointerMove);
elements.map.addEventListener('pointerup', releasePointer);
elements.map.addEventListener('pointercancel', releasePointer);
window.addEventListener('popstate', () => void renderCurrentScope());
void start();
