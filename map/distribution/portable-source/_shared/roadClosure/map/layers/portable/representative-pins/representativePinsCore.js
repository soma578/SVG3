import { fetchWithRuntimeCache } from './runtimeCache.js';
import { MAP_MESSAGES } from './mapMessages.js';
import { displayStatusForObservation } from './observationFreshness.js';
import { decodeDensityPointDocument } from './densityPointFormat.js';
import { PIN_LAYER_PROFILES, resolvePinProfile } from './pinLayerProfiles.js';
import { showPropertyModal } from './propertyModal.js';
import {
  densityLimitForZoom,
  selectQtctDensityCells,
  selectQtctFeatures,
  targetDepthForZoom,
} from './qtctFeatureEngine.js';

export const initRepresentativePinsLayer = ({
  mode = 'portable',
  renderFeatureDetail = null,
  bridge = null,
  refreshIntervalMs = 0,
} = {}) => {
  window.hiddenOnLayerLoad = () => {};

  const VERSION = 'representative-pins-qtct-2026-08-05.7';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const DRAW_GROUP_ID = 'representative-pins-draw';

  const state = {
    dataUrl: '',
    summaryDataUrl: '',
    districtSvgUrlTemplate: '',
    // 記録が属する県の詳細を、その1件のためだけに引くためのテンプレート。
    // 全国detailを常時読ませずに、選んだ地点の詳細だけ補える。
    detailByRegionUrlTemplate: '',
    detailByRegion: new Map(),
    layerId: 'evacuation',
    detailTree: null,
    detailRecordIndex: null,
    summaryTree: null,
    overlaySummaryTree: null,
    overlayDetailTree: null,
    overlayVersion: 0,
    // シャード状態は summary / detail の両方が持つ。detail も全国シャードに
    // なったので、県境をまたいでも表示範囲のぶんだけ取れる。
    shards: {
      summary: { index: null, trees: new Map(), loading: new Map(), failures: new Map() },
      detail: { index: null, trees: new Map(), loading: new Map(), failures: new Map() },
    },
    detailLoaded: false,
    summaryLoaded: false,
    detailLoading: false,
    summaryLoading: false,
    detailLoadedAt: 0,
    summaryLoadedAt: 0,
    districtsByCode: {},
    codesLoaded: new Set(),
    codesLoading: new Set(),
    selectedMunicipalityCodes: new Set(),
    visible: true,
    signature: '',
    // Evacuation live-status overlay: { [recordId]: status }, fetched independently of
    // the static QTCT tree so a status change never re-pulls the heavy tree.
    statusOverlayUrl: '',
    statusOverlay: {},
    statusOverlayLoaded: false,
    statusOverlayLoading: false,
    statusOverlayLoadedAt: 0,
    statusOverlayVersion: 0,
    profileOverride: null,
    profileKey: '',
    forceNetworkUntil: 0,
  };

  // Per-target load sequence. MUST be separate for summary vs detail: a shared counter let a
  // fast detail load invalidate the slow 66MB summary load (seq !== loadSeq), discarding it AND
  // leaving summaryLoading stuck true → national pins never appeared.
  const loadSeqByTarget = { summary: 0, detail: 0 };
  const loadPromiseByTarget = { summary: null, detail: null };
  let lastRenderedSignature = '';
  let nativeRefreshTimer = null;
  let viewportWatchTimer = null;
  let observedViewportKey = '';
  // 表示範囲の世代。パン/ズームのたびに進める。古い取得結果の再描画を止める。
  let viewGeneration = 0;
  const LIVE_REVALIDATE_MS = 15_000;

  const viewportKey = () => {
    const view = window.svgMap?.getGeoViewBox?.();
    if (!view) return '';
    return [view.x, view.y, view.width, view.height]
      .map((value) => Number(value).toFixed(6)).join(',');
  };

  const scheduleNativePoiRefresh = () => {
    if (mode !== 'portable' || nativeRefreshTimer) return;
    nativeRefreshTimer = window.setTimeout(() => {
      nativeRefreshTimer = null;
      try {
        // refreshScreen performs dynamicLoad -> parseSVG after the current preRender stack,
        // which registers the newly inserted native POIs without changing the viewport.
        const root = window.svgImage?.documentElement;
        root?.setAttribute?.('data-native-poi-ready', 'false');
        Promise.resolve(window.svgMap?.refreshScreen?.()).then(() => {
          root?.setAttribute?.('data-native-poi-ready', 'true');
          return window.svgMap?.refreshScreen?.();
        }).catch((error) => {
          console.warn('[representativePinsLayer] native POI readiness refresh failed', error);
        });
      } catch (error) {
        console.warn('[representativePinsLayer] native POI refresh failed', error);
      }
    }, 50);
  };

  /**
   * 描画したPOI集合が変わったことを伝える。
   *
   * 「ピンが1件以上あるときだけ」再構築してはいけない。
   * SVGMap 側の当たり判定は refreshScreen() の再解析でしか作り直されないので、
   * 0件になった/レイヤーを消した/summary と detail を切り替えた、という遷移で
   * 再構築を飛ばすと、表示は消えているのにクリックだけ効く状態が残る。
   */
  const notePoiSetChanged = (key, featureCount) => {
    if (lastRenderedSignature === key) return;
    lastRenderedSignature = key;
    if (mode === 'portal') {
      bridge?.emitPoiLayerRendered?.({
        layerId: state.layerId,
        featureCount,
        signature: key,
        renderedAt: Date.now(),
      });
      return;
    }
    scheduleNativePoiRefresh();
  };

  const parseHashParams = () => {
    const raw = String(window.svgImageProps?.hash || window.svgImageProps?.Path?.split('#')?.[1] || '');
    const params = new URLSearchParams(raw.replace(/^#/, ''));
    state.dataUrl = params.get('data') || state.dataUrl;
    state.summaryDataUrl = params.get('summary') || state.summaryDataUrl || state.dataUrl;
    state.districtSvgUrlTemplate = params.get('districtSvgUrlTemplate') || state.districtSvgUrlTemplate;
    state.detailByRegionUrlTemplate = params.get('detailByRegion') || state.detailByRegionUrlTemplate;
    state.layerId = params.get('layer') || state.layerId;
    state.statusOverlayUrl = params.get('statusOverlay') || state.statusOverlayUrl;
    const profileParam = params.get('profile') || '';
    if (profileParam) {
      try {
        const parsed = JSON.parse(profileParam);
        state.profileOverride = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : null;
        state.profileKey = state.profileOverride ? JSON.stringify(state.profileOverride) : '';
      } catch (error) {
        console.warn('[representativePinsLayer] profile param parse failed', error);
        state.profileOverride = null;
        state.profileKey = '';
      }
    }
    const municipalities = params.get('municipalityCodes') || '';
    if (municipalities) {
      state.selectedMunicipalityCodes = new Set(municipalities.split(',').filter(Boolean));
    }
  };

  // ホストへ直接報告する既定経路。bridge が渡されない構成 (実際に全レイヤーが
  // そうだった) でも状態が捨てられないようにする。単体起動時は親が自分自身なので
  // 何もしない。
  const postDataStatusToHost = (entry) => {
    if (typeof window === 'undefined' || window.parent === window) return;
    try {
      window.parent.postMessage(
        { type: MAP_MESSAGES.runtimeDataStatus, payload: entry },
        window.location.origin === 'null' ? '*' : window.location.origin,
      );
    } catch (error) {
      console.warn('[representativePinsCore] dataStatus post failed', error);
    }
  };

  const emitDataStatus = (payload) => {
    const entry = {
      online: navigator.onLine,
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    if (bridge?.emitDataStatus) bridge.emitDataStatus(entry);
    else postDataStatusToHost(entry);
  };

  // このレイヤーインスタンスのプロファイル (ビジネスルールは pinLayerProfiles.js に集約)
  const profile = () => resolvePinProfile(state.layerId, state.profileOverride);

  // statusAliases から逆引きテーブルを構築してキャッシュ (layerId はインスタンス毎に不変)
  let statusLookup = null;
  let statusLookupFor = '';
  const normalizeStatus = (status) => {
    const p = profile();
    const lookupKey = `${state.layerId}:${state.profileKey}`;
    if (statusLookupFor !== lookupKey) {
      statusLookup = {};
      for (const [canonical, aliases] of Object.entries(p.statusAliases)) {
        statusLookup[canonical] = canonical;
        for (const alias of aliases) statusLookup[alias] = canonical;
      }
      statusLookupFor = lookupKey;
    }
    const value = String(status || '').trim().toLowerCase();
    return statusLookup[value] || p.defaultStatus;
  };

  const parsePoly = (d) => {
    const pts = [];
    for (const [, x, y] of String(d || '').matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
      pts.push([parseFloat(x), parseFloat(y)]);
    }
    return pts;
  };

  const pip = (lon, lat, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const centroidOfPoly = (pts) => {
    if (!pts.length) return null;
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x0, y0] = pts[j];
      const [x1, y1] = pts[i];
      const cross = x0 * y1 - x1 * y0;
      twiceArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (twiceArea === 0) {
      let slon = 0, slat = 0;
      for (const [lon, lat] of pts) { slon += lon; slat += lat; }
      return { cx: (slon / pts.length) * 100, cy: -(slat / pts.length) * 100 };
    }
    const area = twiceArea / 2;
    return { cx: (cx / (6 * area)) * 100, cy: -(cy / (6 * area)) * 100 };
  };

  const pathAreaAbs = (pts) => {
    if (pts.length < 3) return 0;
    let twiceArea = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [x0, y0] = pts[j];
      const [x1, y1] = pts[i];
      twiceArea += x0 * y1 - x1 * y0;
    }
    return Math.abs(twiceArea / 2);
  };

  const findMatchesIn = (record, paths) => {
    if (!paths?.length) return [];
    return paths.filter((p) => pip(record.lon, record.lat, p.poly));
  };

  const findMatchesAcrossLoadedDistricts = (record, preferredCode) => {
    const matches = [];
    const preferred = preferredCode ? state.districtsByCode[preferredCode] : null;
    matches.push(...findMatchesIn(record, preferred));
    for (const [code, paths] of Object.entries(state.districtsByCode)) {
      if (preferredCode && code === preferredCode) continue;
      if (matches.length > 0) break;
      matches.push(...findMatchesIn(record, paths));
    }
    return matches;
  };

  const isLiveDataUrl = (url) => String(url || '').startsWith('/api/');

  // Fetch the evacuation live-status overlay independently of the QTCT tree.
  // Endpoint returns { [recordId]: status }; empty object is a valid (pre-table) state.
  const loadStatusOverlay = async () => {
    if (!state.statusOverlayUrl || state.statusOverlayLoading) return;
    if (state.statusOverlayLoaded
      && state.statusOverlayLoadedAt
      && Date.now() - state.statusOverlayLoadedAt < LIVE_REVALIDATE_MS) return;
    state.statusOverlayLoading = true;
    try {
      const res = await fetch(state.statusOverlayUrl, { cache: 'no-store' });
      const json = res.ok ? await res.json() : {};
      state.statusOverlay = (json && typeof json === 'object' && !Array.isArray(json)) ? json : {};
    } catch {
      state.statusOverlay = {};
    } finally {
      state.statusOverlayLoaded = true;
      state.statusOverlayLoadedAt = Date.now();
      state.statusOverlayLoading = false;
      state.statusOverlayVersion++;
      window.svgMap?.refreshScreen?.();
    }
  };

  /**
   * 地区境界SVGのURL。
   * 全国 detail には他県の記録も混ざるので、「今表示している県」ではなく
   * 「その記録が属する県」から引く。取り違えると、沖縄を表示中に
   * /data/okinawa/districts-svg/33101.svg(岡山市) を叩いて 404 になる。
   */
  const districtSvgUrl = (code, regionId) => {
    const template = state.districtSvgUrlTemplate;
    if (!template || !template.includes('{code}')) return null;
    if (template.includes('{recordRegionId}')) {
      if (!regionId) return null;
      return template.replaceAll('{recordRegionId}', regionId).replace('{code}', code);
    }
    return template.replace('{code}', code);
  };

  const loadDistrictSvg = async (code, regionId) => {
    const url = districtSvgUrl(code, regionId);
    if (!url) return;
    if (!code || state.codesLoaded.has(code) || state.codesLoading.has(code)) return;
    state.codesLoading.add(code);
    try {
      const { data: text } = await fetchWithRuntimeCache(url, 'representative:district:' + code, {
        responseType: 'text',
        label: '地区境界',
        emitDataStatus,
        logLabel: 'representativePinsLayer',
      });
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      const pathEls = Array.from(doc.querySelectorAll('path'));
      const paths = pathEls.map((el) => {
        const rawD = el.getAttribute('d') || '';
        const poly = parsePoly(rawD);
        return { code, poly, centroid: centroidOfPoly(poly), area: pathAreaAbs(poly) };
      }).filter((p) => p.poly.length >= 3);
      state.districtsByCode[code] = paths.length > 0 ? paths : null;
    } catch (error) {
      console.error('[representativePinsLayer] district load failed', { code, error });
      state.districtsByCode[code] = null;
    } finally {
      state.codesLoaded.add(code);
      state.codesLoading.delete(code);
      window.svgMap?.refreshScreen?.();
    }
  };

  const intersects = (bounds, view) =>
    Boolean(bounds && view) &&
    bounds.maxLon >= view.x &&
    bounds.minLon <= view.x + view.width &&
    bounds.maxLat >= view.y &&
    bounds.minLat <= view.y + view.height;

  // 未取得のシャードはインデックスの情報だけでスタブノードにしておく。こうすると
  // 全国ズームでも粗いピンが即座に出せて、シャード本体を取りに行かずに済む。
  const shardState = (target) => state.shards[target];

  const shardNode = (target, shard) =>
    shardState(target).trees.get(shard.id) || {
      depth: Number(shard.depth) || 0,
      bounds: shard.bounds,
      count: shard.count,
      representative: shard.representative || null,
      stub: true,
    };

  const densityCellsFromIndex = (index) => {
    if (Array.isArray(index?.densityCells)) return index.densityCells;
    const grid = index?.densityGrid;
    const depth = Number(grid?.depth);
    if (!Number.isInteger(depth) || !Array.isArray(grid?.cells) || !index?.bounds) return [];
    const side = 2 ** depth;
    const width = (index.bounds.maxLon - index.bounds.minLon) / side;
    const height = (index.bounds.maxLat - index.bounds.minLat) / side;
    return grid.cells.map(([key, count]) => {
      const x = Number(key) % side;
      const y = Math.floor(Number(key) / side);
      return {
        depth,
        count,
        bounds: {
          minLon: index.bounds.minLon + x * width,
          minLat: index.bounds.minLat + y * height,
          maxLon: index.bounds.minLon + (x + 1) * width,
          maxLat: index.bounds.minLat + (y + 1) * height,
        },
      };
    });
  };

  const rebuildShardTree = (target) => {
    const store = shardState(target);
    if (!store.index) return;
    const shards = store.index.shards || [];
    const tree = {
      depth: 0,
      bounds: store.index.bounds,
      count: store.index.total,
      representative: store.index.representative,
      densityPoints: store.index._densityPoints || null,
      densityCells: target === 'summary' ? densityCellsFromIndex(store.index) : [],
      children: shards.length > 0
        ? shards.map((shard) => shardNode(target, shard)).filter((node) => node.representative || !node.stub)
        : [...store.trees.values()],
    };
    if (target === 'summary') state.summaryTree = tree;
    else state.detailTree = tree;
  };

  const decodeDensityPoints = (document, bounds) => {
    try {
      return decodeDensityPointDocument(document, {
        fallbackBounds: bounds,
        decodeBase64: (base64) => {
          const binary = window.atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          return bytes;
        },
      });
    } catch (error) {
      console.warn('[representativePinsCore] density point decode failed', error);
      return null;
    }
  };

  const fetchDensityPoints = async (metadata, summaryUrl) => {
    if (!metadata?.densityPointsUrl) return null;
    const densityUrl = new URL(metadata.densityPointsUrl, new URL(summaryUrl, window.location.href)).href;
    const { data: densityDocument } = await fetchWithRuntimeCache(
      densityUrl,
      `representative:${state.layerId}:density-points`,
      {
        label: profile().label,
        emitDataStatus,
        logLabel: 'representativePinsLayer',
        requestCache: Date.now() < state.forceNetworkUntil ? 'no-cache' : 'default',
      },
    );
    return decodeDensityPoints(densityDocument, densityDocument?.bounds || metadata.bounds);
  };

  const loadShard = async (target, shard) => {
    const store = shardState(target);
    if (!shard?.id || store.trees.has(shard.id)) return;
    if (store.loading.has(shard.id)) return store.loading.get(shard.id);
    const failedAt = store.failures.get(shard.id) || 0;
    if (Date.now() - failedAt < 30_000) return;
    const baseUrl = target === 'summary' ? state.summaryDataUrl : state.dataUrl;
    const url = new URL(shard.url, new URL(baseUrl, window.location.href)).href;
    // このシャードを要求した時点の表示範囲。応答が返るころには
    // 利用者が別の場所へ動いているかもしれない。
    const requestedAtGeneration = viewGeneration;
    const promise = (async () => {
      try {
        const { data, source, metrics } = await fetchWithRuntimeCache(
          url,
          `representative:${state.layerId}:${target}:${shard.id}`,
          {
            label: profile().label,
            emitDataStatus,
            logLabel: 'representativePinsLayer',
            requestCache: Date.now() < state.forceNetworkUntil ? 'no-cache' : 'default',
          },
        );
        if (data?.tree) {
          if (target === 'summary' && data.densityPoints) {
            data.tree.densityPoints = decodeDensityPoints(data.densityPoints, data.bounds || shard.bounds);
          }
          store.trees.set(shard.id, data.tree);
          store.failures.delete(shard.id);
          rebuildShardTree(target);
          state.signature = '';
          console.log('[representativePinsCore] QTCT shard loaded', {
            layerId: state.layerId,
            target,
            shardId: shard.id,
            source,
            ...metrics,
          });
        }
      } catch (error) {
        store.failures.set(shard.id, Date.now());
        console.error('[representativePinsCore] shard load failed', { target, shardId: shard.id, url, error });
      } finally {
        store.loading.delete(shard.id);
        // 表示範囲が動いた後に届いた応答で、今の画面を描き直さない。
        // 取り込み自体は済ませてある（後で同じ場所へ戻れば再取得しない）が、
        // 画面外のシャードのために全体を再描画する意味はない。
        const stillRelevant = requestedAtGeneration === viewGeneration
          || intersects(shard.bounds, window.svgMap?.getGeoViewBox?.());
        if (!stillRelevant) return;
        // 自分で描き直す。refreshScreen() だけに任せると、視野を一度に大きく
        // 変えた直後（検索で他県の市へ飛ぶ等）に再描画が走らず、シャードは
        // 届いているのにクラスタ表示のまま止まる。
        draw();
        window.svgMap?.refreshScreen?.();
      }
    })();
    store.loading.set(shard.id, promise);
    return promise;
  };

  // シャード本体が要るのは、そのシャードの根より細かい深さを描くときだけ。
  // 根で足りるズーム (全国表示など) ではインデックスのスタブで描き切る。
  const ensureShardsForView = (target, view, targetDepth) => {
    const store = shardState(target);
    if (!store.index?.shards || !view) return;
    for (const shard of store.index.shards) {
      // 表示範囲に交差しないシャードは取りに行かない。
      if (!intersects(shard.bounds, view)) continue;
      const shardDepth = Number(shard.depth);
      // 詳細は個別ピンを出すため、根の代表では代用できない。
      if (target === 'summary'
        && shard.representative
        && Number.isFinite(shardDepth)
        && targetDepth <= shardDepth) continue;
      void loadShard(target, shard);
    }
  };

  const clearGroup = () => {
    const root = window.svgImage?.documentElement;
    if (!root || !window.svgImage?.createElement) return null;
    window.svgImage.getElementById?.(DRAW_GROUP_ID)?.remove?.();
    const group = window.svgImage.createElement('g');
    group.setAttribute('id', DRAW_GROUP_ID);
    root.appendChild(group);
    return { group };
  };

  const drawDensityCells = (group, cells, layerProfile) => {
    if (!group || cells.length === 0) return;
    const view = window.svgMap?.getGeoViewBox?.();
    if (!view || !Number.isFinite(Number(view.width)) || !Number.isFinite(Number(view.height))) return;
    // 本家 ClientSideQTCT と同じ、各QTCTタイル96pxの世界固定ラスタ。
    // levelも本家同様に現在ズームのfloorを使うため、画面上では約3〜4px/画素になる。
    const level = Math.max(0, Math.floor(currentZoom(view)));
    const step = 360 / (2 ** level * 96);
    const minGX = Math.floor((Number(view.x) + 180) / step);
    const maxGX = Math.floor((Number(view.x) + Number(view.width) + 180) / step);
    const minGY = Math.floor((Number(view.y) + 180) / step);
    const maxGY = Math.floor((Number(view.y) + Number(view.height) + 180) / step);
    const rasterWidth = maxGX - minGX + 1;
    const rasterHeight = maxGY - minGY + 1;
    if (rasterWidth <= 0 || rasterHeight <= 0 || rasterWidth * rasterHeight > 2_000_000) return;
    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const imageData = context.createImageData(rasterWidth, rasterHeight);
    const color = layerProfile.densityColor || layerProfile.color || '#2563eb';
    const hex = color.replace(/^#/, '');
    const rgb = hex.length === 6
      ? [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
      : [37, 99, 235];
    let occupied = 0;
    const setPixel = (gx, gy) => {
      if (gx < minGX || gx > maxGX || gy < minGY || gy > maxGY) return false;
      const px = gx - minGX;
      const py = maxGY - gy;
      const base = (py * rasterWidth + px) * 4;
      if (imageData.data[base + 3] === 0) occupied += 1;
      imageData.data[base] = rgb[0];
      imageData.data[base + 1] = rgb[1];
      imageData.data[base + 2] = rgb[2];
      imageData.data[base + 3] = 190;
      return true;
    };
    for (const cell of cells) {
      const fromGX = Math.max(minGX, Math.floor((Number(cell.bounds.minLon) + 180) / step));
      const toGX = Math.min(maxGX, Math.floor((Number(cell.bounds.maxLon) + 180) / step));
      const fromGY = Math.max(minGY, Math.floor((Number(cell.bounds.minLat) + 180) / step));
      const toGY = Math.min(maxGY, Math.floor((Number(cell.bounds.maxLat) + 180) / step));
      if (toGX < fromGX || toGY < fromGY) continue;
      const centerGX = (fromGX + toGX) / 2;
      const centerGY = (fromGY + toGY) / 2;
      const candidates = [];
      for (let gy = fromGY; gy <= toGY; gy += 1) {
        for (let gx = fromGX; gx <= toGX; gx += 1) {
          // 低ズームから個別ピン直前まで同じ規則で中心から連続的に埋める。
          // ズームするとQTCT区画そのものが細分化されるため、9.5で表示密度が
          // 突然落ちることなく、自然に個別地点へ近づいていく。
          candidates.push({
            gx,
            gy,
            ring: Math.max(Math.abs(gx - centerGX), Math.abs(gy - centerGY)),
            distance: Math.abs(gx - centerGX) + Math.abs(gy - centerGY),
          });
        }
      }
      candidates.sort((a, b) => a.ring - b.ring
        || a.distance - b.distance || a.gy - b.gy || a.gx - b.gx);
      const fillCount = Math.min(
        candidates.length,
        Math.max(1, Math.round(Number(cell.count) || 1)),
      );
      for (let index = 0; index < fillCount; index += 1) {
        setPixel(candidates[index].gx, candidates[index].gy);
      }
    }
    if (occupied === 0) return;
    context.putImageData(imageData, 0, 0);
    const image = window.svgImage.createElement('image');
    const href = canvas.toDataURL('image/png');
    image.setAttribute('href', href);
    image.setAttributeNS(XLINK_NS, 'xlink:href', href);
    image.setAttribute('x', String((minGX * step - 180) * 100));
    image.setAttribute('y', String(-(maxGY + 1) * step * 100 + 18000));
    image.setAttribute('width', String(rasterWidth * step * 100));
    image.setAttribute('height', String(rasterHeight * step * 100));
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('style', 'image-rendering:pixelated');
    image.setAttribute('pointer-events', 'none');
    image.setAttribute('data-density-layer', state.layerId);
    image.setAttribute('data-density-count', String(occupied));
    image.setAttribute('data-density-cell-count', String(cells.length));
    image.setAttribute('data-density-source-count', String(cells.reduce((sum, cell) => sum + Number(cell.count || 0), 0)));
    image.setAttribute('data-density-shape', 'pixel-raster');
    image.setAttribute('data-density-mode', 'continuous-coverage');
    image.setAttribute('data-density-color', color);
    const canvasWidth = Number(window.svgMap?.getCanvasSize?.()?.width);
    image.setAttribute('data-density-pixel-css', String(canvasWidth > 0 ? canvasWidth * step / Number(view.width) : 0));
    group.appendChild(image);
  };

  const featurePayload = (item) => ({
    id: item.id,
    title: item.title,
    layerId: item.layerId || state.layerId,
    category: item.layerId || state.layerId,
    kind: item.representative ? 'representative-pin' : profile().individualKind,
    status: item.status,
    lat: item.lat,
    lon: item.lon,
    representative: item.representative,
    count: item.count,
    summary: item.summary || '',
    description: item.description || '',
    address: item.address || '',
    municipalityCode: item.municipalityCode || '',
    regionId: item.regionId || '',
    capacity: item.capacity ?? null,
    area: item.area || '',
    operator: item.operator || '',
    cameraId: item.cameraId || '',
    river: item.river || '',
    location: item.location || '',
    imageUrl: item.imageUrl || '',
    normalImageUrl: item.normalImageUrl || '',
    liveUrl: item.liveUrl || '',
    pageUrl: item.pageUrl || '',
    provider: item.provider || '',
    properties: item.properties && typeof item.properties === 'object' ? item.properties : {},
  });

  const contentFor = (feature) => [
    feature.id || '',
    feature.title || '',
    feature.status || '',
    feature.address || '',
    feature.area || '',
    feature.operator || '',
    feature.summary || '',
    feature.municipalityCode || '',
  ].map((value) => String(value ?? '').replace(/[\r\n,]/g, ' ').trim()).join(',');

  // グローバル座標系は 1度 = 100単位 (matrix(100,0,0,-100,0,0))。ピンの配置でも
  // 同じ換算を使っている。
  const UNITS_PER_DEGREE = 100;

  /**
   * 現在のズーム。
   *
   * svgImageProps.scale は、視野を一度に大きく変えた直後（検索で他県の市へ飛ぶ、
   * パーマリンクで開く等）に前の値のまま残ることがある。その値を信じると、
   * 市街地まで寄っているのにクラスタ表示のままになり、避難所の個別ピンが出ない。
   * 常に最新である geoViewBox と描画領域の大きさから求め、それが取れないときだけ
   * svgImageProps.scale に頼る。
   */
  const currentZoom = (geoViewBox) => {
    const zoomFromScale = (scale) => Math.LOG2E * Math.log(scale) + 7.25;
    const canvasWidth = Number(window.svgMap?.getCanvasSize?.()?.width);
    const viewWidth = Number(geoViewBox?.width);
    if (canvasWidth > 0 && viewWidth > 0) {
      return zoomFromScale(canvasWidth / (viewWidth * UNITS_PER_DEGREE));
    }
    const scale = Number(window.svgImageProps?.scale);
    return scale > 0 ? zoomFromScale(scale) : 8;
  };

  const displayPointForItem = (item, { useDetail = true } = {}) => {
    const code = item.municipalityCode || '';
    let lon = Number(item.lon);
    let lat = Number(item.lat);
    if (profile().placement !== 'districtCentroid' || !code) return { lon, lat };
    // 地区重心への補正は詳細表示(地域スコープのdetail)でのみ意味がある。
    // 全国summaryのクラスタから引くと、別地域を見ているのに他県の市区町村コードで
    // 地区SVGを取りに行って404になる（広島表示中に /data/hiroshima/.../33101.svg 等）。
    if (!useDetail) return { lon, lat };
    if (!state.districtsByCode[code] && !state.codesLoading.has(code)) {
      void loadDistrictSvg(code, item.regionId);
    }
    const paths = state.districtsByCode[code];
    const matched = paths?.length ? findMatchesIn(item, paths) : [];
    const recovered = matched.length > 0
      ? matched.reduce((best, path) => ((best?.area || 0) >= (path.area || 0) ? best : path), matched[0])
      : (findMatchesAcrossLoadedDistricts(item, code)[0] || null);
    if (recovered?.centroid) {
      lon = recovered.centroid.cx / 100;
      lat = recovered.centroid.cy / -100;
    }
    return { lon, lat };
  };

  const currentRenderContext = () => {
    const geoViewBox = window.svgMap?.getGeoViewBox?.();
    if (!geoViewBox || !Number.isFinite(Number(geoViewBox.width))) return null;
    const zoom = currentZoom(geoViewBox);
    const showIndividuals = zoom >= Number(profile().individualZoom || 11);
    // 個別表示へ切り替えたら、低ズーム用の浅いQTCT深度に留まらず葉まで辿る。
    // 閾値だけを早めて探索深度を据え置くと、詳細レコードではなく代表ピンが残る。
    const targetDepth = showIndividuals ? targetDepthForZoom(12) : targetDepthForZoom(zoom);
    const useDetail = showIndividuals;
    return {
      geoViewBox,
      zoom,
      targetDepth,
      showIndividuals,
      useDetail,
      densityLimit: densityLimitForZoom(zoom),
      activeTree: useDetail ? state.detailTree : state.summaryTree,
      activeLoaded: useDetail ? state.detailLoaded : state.summaryLoaded,
      activeUrl: useDetail ? state.dataUrl : state.summaryDataUrl,
      activeLoadedAt: useDetail ? state.detailLoadedAt : state.summaryLoadedAt,
    };
  };

  const draw = () => {
    const drawStartedAt = performance.now();
    parseHashParams();
    ensureIconDefs();
    if (!state.visible) {
      clearGroup();
      state.signature = '';
      // 消した事実を伝えないと、SVGMap 側に当たり判定だけが残る。
      notePoiSetChanged('hidden', 0);
      return;
    }
    let context = currentRenderContext();
    if (!context) return;
    // summary / detail のどちらでも、表示範囲に交差するシャードを揃える。
    const activeTarget = context.useDetail ? 'detail' : 'summary';
    const globalDensityReady = !context.showIndividuals
      && Boolean(shardState(activeTarget).index?._densityPoints?.length);
    if (shardState(activeTarget).index && !globalDensityReady) {
      ensureShardsForView(activeTarget, context.geoViewBox, context.targetDepth);
      context = currentRenderContext();
    }
    const {
      geoViewBox,
      targetDepth,
      showIndividuals,
      useDetail,
      densityLimit,
      activeTree,
      activeLoaded,
      activeUrl,
      activeLoadedAt,
    } = context;
    // detail へ切り替えた直後は index がまだ無く、そのまま消すとピンが一瞬0件になる。
    // 新しい側が揃うまでは既に持っている側（通常は summary）で描き続ける。
    // 描けるものが1つでもあれば「使える」。子も記録も無いが代表だけ持つ形は
    // summary のスリム化で普通に出る（件数が少ない層は根1ノードに畳まれる）。
    // これを使えない扱いにすると、河川水位のように8件以下の層が丸ごと消える。
    const activeUsable = Boolean(activeTree)
      && (activeTree.children?.length > 0
        || Array.isArray(activeTree.records)
        || Boolean(activeTree.representative));
    const fallbackTree = useDetail ? state.summaryTree : state.detailTree;
    const renderTree = activeUsable ? activeTree : fallbackTree;
    const renderIsFallback = !activeUsable && Boolean(renderTree);
    if (!renderTree) {
      // どちらも無いときだけ消す。
      if (shardState(activeTarget).index) {
        clearGroup();
        notePoiSetChanged(`empty:${activeTarget}`, 0);
        return;
      }
    }
    if (isLiveDataUrl(activeUrl) && activeLoaded && activeLoadedAt && Date.now() - activeLoadedAt > LIVE_REVALIDATE_MS) {
      if (useDetail) {
        state.detailLoaded = false;
      } else {
        state.summaryLoaded = false;
      }
      state.signature = '';
      window.svgMap?.refreshScreen?.();
      return;
    }
    if (!activeLoaded) {
      void loadTree(useDetail ? 'detail' : 'summary');
      return;
    }
    if (!renderTree) return;
    // Live-status overlay is only meaningful at detail zoom (leaf records). Driven purely by
    // the statusOverlay hash param (containers opt layers in). Loaded independently of the
    // tree; re-render is triggered via statusOverlayVersion.
    const applyOverlay = useDetail && state.statusOverlayUrl;
    if (applyOverlay) void loadStatusOverlay();
    const signature = [
      VERSION,
      state.layerId,
      state.profileKey,
      useDetail ? state.dataUrl : state.summaryDataUrl,
      targetDepth,
      densityLimit,
      state.statusOverlayVersion,
      state.overlayVersion,
      state.codesLoaded.size,
      state.shards.summary.trees.size,
      state.shards.detail.trees.size,
      renderIsFallback ? 'fallback' : 'active',
      Number(geoViewBox.x).toFixed(4),
      Number(geoViewBox.y).toFixed(4),
      Number(geoViewBox.width).toFixed(4),
      Number(geoViewBox.height).toFixed(4),
      state.visible ? 'visible' : 'hidden',
    ].join('|');
    if (state.signature === signature) return;
    state.signature = signature;

    const showDensity = !showIndividuals && context.zoom < Number(profile().densityMaxZoom || 11);
    const overlayTree = useDetail ? state.overlayDetailTree : state.overlaySummaryTree;
    const items = showDensity ? [] : [
      ...selectQtctFeatures({
        tree: renderTree,
        view: geoViewBox,
        // 代替表示中は個別ピンを名乗らせない（summary には個票が無い）。
        zoom: renderIsFallback && useDetail ? 0 : context.zoom,
        individualZoom: profile().individualZoom,
      }),
      ...(overlayTree ? selectQtctFeatures({
        tree: overlayTree, view: geoViewBox, zoom: context.zoom,
        individualZoom: profile().individualZoom,
      }) : []),
    ];
    const groups = clearGroup();
    if (!groups) return;
    const { group } = groups;
    if (showDensity) {
      drawDensityCells(group, [
        ...selectQtctDensityCells({ tree: renderTree, view: geoViewBox, zoom: context.zoom }),
        ...(overlayTree ? selectQtctDensityCells({
          tree: overlayTree, view: geoViewBox, zoom: context.zoom,
        }) : []),
      ], profile());
    }
    for (const rawItem of items) {
      const use = window.svgImage.createElement('use');
      const layerId = rawItem.layerId || state.layerId;
      // Apply the live-status overlay to evac leaf records only (reps stay hardcoded 'open').
      const override = (applyOverlay && !rawItem.representative)
        ? state.statusOverlay[rawItem.id]
        : undefined;
      const item = (override != null && override !== '') ? { ...rawItem, status: override } : rawItem;
      const status = item.representative && profile().representativeStatus
        ? profile().representativeStatus
        : displayStatusForObservation(normalizeStatus(item.status), {
          record: item,
          staleAfterMinutes: profile().observationStaleAfterMinutes,
          expiredStatus: profile().expiredStatus || 'stale',
        });
      const isSummaryPin = !showIndividuals;
      const variant = isSummaryPin ? 'summary' : 'detail';
      const displayPoint = displayPointForItem(item, { useDetail });
      const cx = displayPoint.lon * 100;
      const cy = displayPoint.lat * -100;
      use.setAttribute('href', `#rep-pin-${layerId}-${status}-${variant}`);
      use.setAttributeNS(XLINK_NS, 'xlink:href', `#rep-pin-${layerId}-${status}-${variant}`);
      use.setAttribute('x', '0');
      use.setAttribute('y', '0');
      use.setAttribute('transform', `ref(svg,${cx.toFixed(5)},${cy.toFixed(5)})`);
      use.setAttribute('data-feature-id', item.id);
      use.setAttribute('data-layer-id', layerId);
      use.setAttribute('data-kind', item.representative ? 'representative-pin' : 'poi');
      use.setAttribute('data-title', item.title);
      const payload = JSON.stringify(featurePayload(item));
      use.setAttribute('data-feature', payload);
      use.setAttribute('content', contentFor(featurePayload(item)));
      use.setAttribute('xlink:title', item.representative && Number(item.count) > 1
        ? `${profile().label}: ${item.count}件（代表）`
        : item.title);
      use.setAttribute('pointer-events', 'all');
      if (use.style) use.style.pointerEvents = 'all';
      group.appendChild(use);
    }
    const root = window.svgImage?.documentElement;
    root?.setAttribute?.('data-native-poi-view', [
      Number(geoViewBox.x).toFixed(4),
      Number(geoViewBox.y).toFixed(4),
      Number(geoViewBox.width).toFixed(4),
      Number(geoViewBox.height).toFixed(4),
    ].join(','));
    root?.setAttribute?.('data-native-poi-count', String(items.length));
    console.debug('[representativePinsCore] draw metrics', {
      layerId: state.layerId,
      featureCount: items.length,
      drawMs: Math.round((performance.now() - drawStartedAt) * 10) / 10,
    });
    notePoiSetChanged(`${signature}#${items.length}`, items.length);
  };

  const ensureIconDefs = () => {
    const svg = window.svgImage;
    const defs = svg?.getElementsByTagName?.('defs')?.[0];
    if (!svg?.createElement || !defs) return;
    const profiles = { ...PIN_LAYER_PROFILES };
    profiles[state.layerId] = profile();
    // def の集合はプロファイルが定義する: rep-pin-{layerId}-{正規status}-{variant}
    for (const [layerId, p] of Object.entries(profiles)) {
      for (const [status, href] of Object.entries(p.icons)) {
        const variants = [
          { key: 'detail', size: 26, opacity: 1 },
          { key: 'summary', size: 26, opacity: 1 },
        ];
        for (const variant of variants) {
          const id = `rep-pin-${layerId}-${status}-${variant.key}`;
          if (svg.getElementById?.(id)) continue;
          const g = svg.createElement('g');
          g.setAttribute('id', id);
          const half = variant.size / 2;
          if (variant.key === 'summary') {
            const color = p.color || p.statusColors?.[status] || '#2563eb';
            let marker;
            if (p.markerShape === 'square') {
              marker = svg.createElement('rect');
              marker.setAttribute('x', String(-half + 1));
              marker.setAttribute('y', String(-half + 1));
              marker.setAttribute('width', String(variant.size - 2));
              marker.setAttribute('height', String(variant.size - 2));
              marker.setAttribute('rx', '3');
            } else if (p.markerShape === 'diamond') {
              marker = svg.createElement('path');
              marker.setAttribute('d', `M0 ${-half + 1} L${half - 1} 0 L0 ${half - 1} L${-half + 1} 0 Z`);
            } else if (p.markerShape === 'triangle') {
              marker = svg.createElement('path');
              marker.setAttribute('d', `M0 ${-half + 1} L${half - 1} ${half - 1} L${-half + 1} ${half - 1} Z`);
            } else if (p.markerShape === 'hexagon') {
              marker = svg.createElement('path');
              marker.setAttribute('d', `M${-half / 2} ${-half + 1} L${half / 2} ${-half + 1} L${half - 1} 0 L${half / 2} ${half - 1} L${-half / 2} ${half - 1} L${-half + 1} 0 Z`);
            } else {
              marker = svg.createElement('circle');
              marker.setAttribute('cx', '0');
              marker.setAttribute('cy', '0');
              marker.setAttribute('r', String(half - 1));
            }
            marker.setAttribute('fill', color);
            marker.setAttribute('stroke', '#ffffff');
            marker.setAttribute('stroke-width', '3');
            marker.setAttribute('opacity', String(variant.opacity));
            const text = svg.createElement('text');
            text.setAttribute('x', '0');
            text.setAttribute('y', '5');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '12');
            text.setAttribute('font-weight', '900');
            text.setAttribute('font-family', 'sans-serif');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('pointer-events', 'none');
            text.textContent = String(p.symbol || p.label || layerId).slice(0, 1);
            g.append(marker, text);
          } else if (href) {
            const img = svg.createElement('image');
            img.setAttribute('href', href);
            img.setAttributeNS(XLINK_NS, 'xlink:href', href);
            img.setAttribute('x', String(-half));
            img.setAttribute('y', String(-half));
            img.setAttribute('width', String(variant.size));
            img.setAttribute('height', String(variant.size));
            img.setAttribute('opacity', String(variant.opacity));
            img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            g.appendChild(img);
          } else {
            const color = p.statusColors?.[status] || p.color || '#2563eb';
            const circle = svg.createElement('circle');
            circle.setAttribute('cx', '0');
            circle.setAttribute('cy', '0');
            circle.setAttribute('r', String(half - 1));
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '3');
            circle.setAttribute('opacity', String(variant.opacity));
            const text = svg.createElement('text');
            text.setAttribute('x', '0');
            text.setAttribute('y', '5');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '13');
            text.setAttribute('font-weight', '800');
            text.setAttribute('font-family', 'sans-serif');
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('pointer-events', 'none');
            text.textContent = String(p.symbol || p.label || layerId).slice(0, 1);
            g.append(circle, text);
          }
          defs.appendChild(g);
        }
      }
    }
  };

  const loadTree = async (target) => {
    const isSummary = target === 'summary';
    const loadedKey = isSummary ? 'summaryLoaded' : 'detailLoaded';
    const loadingKey = isSummary ? 'summaryLoading' : 'detailLoading';
    const treeKey = isSummary ? 'summaryTree' : 'detailTree';
    const loadedAtKey = isSummary ? 'summaryLoadedAt' : 'detailLoadedAt';
    const url = isSummary ? state.summaryDataUrl : state.dataUrl;
    if (state[loadedKey]) return state[treeKey];
    if (loadPromiseByTarget[target]) return loadPromiseByTarget[target];
    if (!url) return null;
    const promise = (async () => {
      state[loadingKey] = true;
      const seq = ++loadSeqByTarget[target];
      try {
        const { data, source, metrics } = await fetchWithRuntimeCache(url, 'representative:' + state.layerId + ':' + target, {
          label: profile().label,
          emitDataStatus,
          logLabel: 'representativePinsLayer',
          requestCache: Date.now() < state.forceNetworkUntil ? 'no-cache' : 'default',
        });
        if (seq !== loadSeqByTarget[target]) return null;
        // summary/detail どちらもシャードインデックスを受け付ける。
        if (data?.kind === 'qtct-shard-index' && Array.isArray(data.shards)) {
          const store = shardState(target);
          store.index = data;
          store.trees = new Map();
          store.failures = new Map();
          if (isSummary && data.densityPointsUrl) {
            try {
              store.index._densityPoints = await fetchDensityPoints(data, url);
            } catch (error) {
              // 古い成果物との互換性を維持する。取得できない場合は従来の
              // densityGrid / summary shardへ縮退し、レイヤー自体は消さない。
              console.warn('[representativePinsCore] global density points unavailable', error);
            }
          }
          rebuildShardTree(target);
        } else if (data?.tree) {
          shardState(target).index = null;
          if (isSummary && data.densityPointsUrl) {
            try {
              data.tree.densityPoints = await fetchDensityPoints(data, url);
            } catch (error) {
              console.warn('[representativePinsCore] global density points unavailable', error);
            }
          }
          state[treeKey] = data.tree;
          if (!isSummary) state.detailRecordIndex = null;
        } else {
          state[treeKey] = null;
          emitDataStatus({
            key: `representative:${state.layerId}:${target}`,
            label: profile().label,
            source: 'fallback',
            url,
            message: 'QTCT tree がありません',
          });
        }
        state[loadedAtKey] = Date.now();
        state[loadedKey] = true;
        console.log('[representativePinsCore] QTCT loaded', {
          mode,
          layerId: state.layerId,
          target,
          url,
          hasTree: Boolean(state[treeKey]),
          shardCount: shardState(target).index?.shards?.length || 0,
          source,
          ...metrics,
        });
        return state[treeKey];
      } catch (error) {
        console.error('[representativePinsLayer] load failed', error);
        state[treeKey] = null;
        state[loadedKey] = true;
        return null;
      } finally {
        if (seq === loadSeqByTarget[target]) {
          state[loadingKey] = false;
          draw();
        }
        loadPromiseByTarget[target] = null;
      }
    })();
    loadPromiseByTarget[target] = promise;
    return promise;
  };


  const customShowPoiProperty = (target) => {
    try {
      const feature = JSON.parse(target?.getAttribute?.('data-feature') || '{}');
      emitFeatureSelect(feature);
    } catch (error) {
      console.warn('[representativePinsLayer] feature parse failed', error);
    }
  };

  const registerPoiHandler = () => {
    const layerId = window.layerID;
    if (window.svgMap?.setShowPoiProperty && layerId) {
      window.svgMap.setShowPoiProperty(customShowPoiProperty, layerId);
      return true;
    }
    return false;
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const renderPortableFeatureHtml = (feature) => {
    const rows = [
      ['Status', feature.status],
      ['Address', feature.address],
      ['Summary', feature.summary],
      ['Description', feature.description],
      ['Area', feature.area],
      ['Operator', feature.operator],
      ['Latitude', feature.lat],
      ['Longitude', feature.lon],
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
    return `
      <section style="font-family: sans-serif; font-size: 13px; line-height: 1.45; word-break: break-word;">
        <h3 style="margin: 0 0 8px; font-size: 16px;">${escapeHtml(feature.title || 'Feature')}</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <tbody>
            ${rows.map(([label, value]) => `
              <tr>
                <th style="border: 1px solid #ddd; padding: 4px 6px; text-align: left; width: 30%; background: #f8fafc;">${escapeHtml(label)}</th>
                <td style="border: 1px solid #ddd; padding: 4px 6px;">${escapeHtml(value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `;
  };

  const detailRecordForId = (id) => {
    if (!id || !state.detailTree) return null;
    if (!state.detailRecordIndex) {
      const index = new Map();
      const pending = [state.detailTree];
      while (pending.length > 0) {
        const node = pending.pop();
        for (const record of node?.records || []) {
          if (record?.id) index.set(record.id, record);
        }
        for (const child of node?.children || []) pending.push(child);
      }
      state.detailRecordIndex = index;
    }
    return state.detailRecordIndex.get(id) || null;
  };

  /**
   * その記録が属する県の詳細から1件を引く。
   *
   * 全国 summary は容量のために pageUrl や住所を落としている。表示中の県の
   * 詳細しか持っていないと、隣県のカメラを選んだときに公式ページの URL が
   * 埋まらないまま詳細を開くことになる。県単位の詳細を必要になった時だけ
   * 取りに行く（全国detailを常時読むより軽い）。
   */
  const recordFromRegionDetail = async (feature) => {
    const template = state.detailByRegionUrlTemplate;
    const regionId = String(feature?.regionId || '');
    if (!template || !regionId || !template.includes('{recordRegionId}')) return null;
    if (!state.detailByRegion.has(regionId)) {
      const url = template.replaceAll('{recordRegionId}', regionId);
      const promise = (async () => {
        try {
          const { data } = await fetchWithRuntimeCache(url, `representative:${state.layerId}:detail:${regionId}`, {
            label: profile().label,
            emitDataStatus,
            logLabel: 'representativePinsLayer',
          });
          const index = new Map();
          const pending = [data?.tree];
          while (pending.length > 0) {
            const node = pending.pop();
            for (const record of node?.records || []) {
              if (record?.id) index.set(record.id, record);
            }
            for (const child of node?.children || []) pending.push(child);
          }
          return index;
        } catch (error) {
          console.warn('[representativePinsCore] region detail unavailable', { regionId, url, error });
          return new Map();
        }
      })();
      state.detailByRegion.set(regionId, promise);
    }
    return (await state.detailByRegion.get(regionId)).get(feature.id) || null;
  };

  const enrichRepresentativeFeature = async (feature) => {
    if (!feature || feature.address || feature.summary || feature.description ||
        feature.cameraId || feature.pageUrl || Object.keys(feature.properties || {}).length > 0) {
      return feature;
    }
    await loadTree('detail');
    const record = detailRecordForId(feature.id) || await recordFromRegionDetail(feature);
    if (!record) return feature;
    return {
      ...feature,
      ...featurePayload(record),
      representative: feature.representative,
      count: feature.count,
    };
  };

  const emitFeatureSelect = async (rawFeature) => {
    const feature = await enrichRepresentativeFeature(rawFeature);
    if (!feature) return;
    if (mode === 'portable' && window.svgMap?.showModal) {
      const html = typeof renderFeatureDetail === 'function'
        ? await renderFeatureDetail(feature)
        : renderPortableFeatureHtml(feature);
      const modal = showPropertyModal(html, { attribution: profile().attribution });
      if (typeof renderFeatureDetail?.afterShow === 'function') {
        renderFeatureDetail.afterShow(feature, modal);
      }
      return;
    }
    bridge?.emitFeatureSelect?.(feature);
  };

  window.preRenderFunction = draw;
  window.addEventListener('zoomPanMap', () => {
    // 表示範囲が変わった。ここより前に投げた取得の応答は、もう今の画面の
    // ものではない可能性がある。
    viewGeneration += 1;
    observedViewportKey = viewportKey();
    draw();
  });
  bridge?.installMessageHandler?.({
    getLayerId: () => state.layerId,
    getNativeLayerId: () => String(window.layerID || ''),
    setDataUrl(nextUrl) {
      if (!nextUrl) return;
      state.dataUrl = nextUrl;
      state.summaryDataUrl = nextUrl;
      state.detailTree = null;
      state.summaryTree = null;
      for (const target of ['summary', 'detail']) {
        state.shards[target] = { index: null, trees: new Map(), loading: new Map(), failures: new Map() };
      }
      state.detailLoaded = false;
      state.summaryLoaded = false;
      state.detailLoading = false;
      state.summaryLoading = false;
      state.signature = '';
      window.svgMap?.refreshScreen?.();
    },
    setMunicipalityFilter(codes) {
      state.selectedMunicipalityCodes = new Set(Array.isArray(codes) ? codes : []);
      state.signature = '';
      window.svgMap?.refreshScreen?.();
    },
    setLayerConfig(config) {
      const newDistrictTemplate = config?.districtSvgUrlTemplate || '';
      if (newDistrictTemplate && newDistrictTemplate !== state.districtSvgUrlTemplate) {
        state.districtSvgUrlTemplate = newDistrictTemplate;
        state.districtsByCode = {};
        state.codesLoaded = new Set();
        state.codesLoading = new Set();
        state.signature = '';
      }
    },
    setVisibility(visible) {
      state.visible = visible !== false;
      state.signature = '';
      window.svgMap?.refreshScreen?.();
    },
  });

  let started = false;
  let dataRefreshTimer = null;
  const invalidateData = () => {
    if (state.summaryLoading || state.detailLoading
      || state.shards.summary.loading.size > 0 || state.shards.detail.loading.size > 0) return;
    loadSeqByTarget.summary += 1;
    loadSeqByTarget.detail += 1;
    loadPromiseByTarget.summary = null;
    loadPromiseByTarget.detail = null;
    state.detailTree = null;
    state.detailRecordIndex = null;
    state.summaryTree = null;
    for (const target of ['summary', 'detail']) {
      state.shards[target] = { index: null, trees: new Map(), loading: new Map(), failures: new Map() };
    }
    state.detailLoaded = false;
    state.summaryLoaded = false;
    state.detailLoading = false;
    state.summaryLoading = false;
    state.signature = '';
    lastRenderedSignature = '';
    state.forceNetworkUntil = Date.now() + 30_000;
    draw();
  };
  const start = () => {
    if (started) return;
    started = true;
    parseHashParams();
    console.log('[representativePinsCore] start', {
      mode,
      layerId: state.layerId,
      summaryDataUrl: state.summaryDataUrl,
      dataUrl: state.dataUrl,
    });
    let tries = 0;
    const timer = setInterval(() => {
      ensureIconDefs();
      if (registerPoiHandler() || ++tries > 30) clearInterval(timer);
    }, 100);
    if (mode === 'portal') {
      bridge?.emitLayerReady?.({
        layerId: state.layerId,
        acceptsRuntimeDataUrl: false,
      });
    }
    const drawWhenViewReady = (attempt = 0) => {
      if (currentRenderContext()) {
        draw();
      } else if (attempt < 10) {
        window.setTimeout(() => drawWhenViewReady(attempt + 1), 100);
      }
    };
    drawWhenViewReady();
    // isolated controller では、ホストが setGeoViewPort した際の zoomPanMap / preRender
    // が届かないランタイムがある。表示範囲だけを軽量に監視し、変化時に限って
    // 描画することで、全国用ピクセルが市区町村表示へ残る状態を防ぐ。
    observedViewportKey = viewportKey();
    viewportWatchTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const nextKey = viewportKey();
      if (!nextKey || nextKey === observedViewportKey) return;
      observedViewportKey = nextKey;
      viewGeneration += 1;
      state.signature = '';
      draw();
    }, 150);
    const interval = Number(refreshIntervalMs);
    if (Number.isFinite(interval) && interval >= 60_000) {
      dataRefreshTimer = window.setInterval(() => {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        invalidateData();
      }, interval);
    }
  };
  window.addEventListener('pagehide', () => {
    if (dataRefreshTimer) window.clearInterval(dataRefreshTimer);
    if (viewportWatchTimer) window.clearInterval(viewportWatchTimer);
    dataRefreshTimer = null;
    viewportWatchTimer = null;
  }, { once: true });
  window.addEventListener('layerWebAppReady', start, { once: true });
  if (window.svgMap && window.svgImage) queueMicrotask(start);
  return {
    setOverlayDocuments({ summary = null, detail = null } = {}) {
      state.overlaySummaryTree = summary?.tree || null;
      state.overlayDetailTree = detail?.tree || null;
      state.overlayVersion += 1;
      state.signature = '';
      lastRenderedSignature = '';
      draw();
      window.svgMap?.refreshScreen?.();
    },
    clearOverlay() {
      state.overlaySummaryTree = null;
      state.overlayDetailTree = null;
      state.overlayVersion += 1;
      state.signature = '';
      lastRenderedSignature = '';
      draw();
      window.svgMap?.refreshScreen?.();
    },
  };
};

export default initRepresentativePinsLayer;
