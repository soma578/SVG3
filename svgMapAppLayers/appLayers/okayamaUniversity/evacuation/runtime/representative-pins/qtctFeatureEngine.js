export const targetDepthForZoom = (zoom) => {
  if (zoom < 7.5) return 5;
  if (zoom < 9) return 6;
  if (zoom < 10) return 7;
  if (zoom < 10.7) return 8;
  if (zoom < 11.1) return 9;
  if (zoom < 11.4) return 10;
  if (zoom < 12) return 11;
  return 12;
};

export const densityLimitForZoom = (zoom) => {
  if (zoom < 7.5) return 200;
  if (zoom < 9) return 120;
  if (zoom < 10) return 60;
  if (zoom < 10.7) return 32;
  if (zoom < 11.4) return 20;
  return 8;
};

export const intersectsQtctBounds = (bounds, view) => Boolean(bounds && view) &&
  bounds.maxLon >= view.x &&
  bounds.minLon <= view.x + view.width &&
  bounds.maxLat >= view.y &&
  bounds.minLat <= view.y + view.height;

const nodeCount = (node) =>
  Math.max(1, Number(node?.count ?? node?.representative?.count) || 1);

const collectViewportPartitions = (node, view, targetDepth, out) => {
  if (!node || !intersectsQtctBounds(node.bounds, view)) return;
  if (!node.children?.length || node.depth >= targetDepth) {
    out.push(node);
    return;
  }
  node.children.forEach((child) => collectViewportPartitions(child, view, targetDepth, out));
};

const collectViewportDensityPoints = (node, view, out) => {
  if (!node || !intersectsQtctBounds(node.bounds, view)) return;
  const points = node.densityPoints;
  if (points && typeof points.length === 'number') {
    for (let index = 0; index + 1 < points.length; index += 2) {
      const lon = Number(points[index]);
      const lat = Number(points[index + 1]);
      if (lon < view.x || lon > view.x + view.width || lat < view.y || lat > view.y + view.height) continue;
      out.push({
        bounds: { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat },
        count: 1,
        representative: { lon, lat },
      });
    }
    return;
  }
  node.children?.forEach((child) => collectViewportDensityPoints(child, view, out));
};

// density-points が読み込まれている場合、画面内が0件でも「データなし」ではない。
// ここを区別しないと全国ルート区画へフォールバックし、現在画面の中央に架空の
// 密度ピクセルを1つ生成してしまう。
const hasDensityPointData = (node) => Boolean(node) && (
  (node.densityPoints && typeof node.densityPoints.length === 'number')
  || (node.children || []).some(hasDensityPointData)
);

/**
 * 低ズーム用の密度セル。
 * ピンの代表地点を密度のように見せず、QTCTが実際に集計した空間区画を返す。
 */
export const selectQtctDensityCells = ({
  tree,
  view,
  zoom = zoomForGeoView(view),
} = {}) => {
  if (!tree || !view) return [];
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : zoomForGeoView(view);
  // インデックス同梱のdepth 7セルは全国・地方表示用。市区町村表示では、取得済み
  // シャードのQTCTをさらに辿り、粗い25kmセルを約3kmセルへ細分化する。
  // 低・中縮尺とも実地点を同じ世界固定格子へ直接ピクセル化する。本家QTCTの
  // low-res imageと同じく、複数地点が同じ画素へ入った場合だけ自然に集約される。
  const densityPoints = [];
  collectViewportDensityPoints(tree, view, densityPoints);
  if (hasDensityPointData(tree)) return densityPoints;
  if (Array.isArray(tree.densityCells) && normalizedZoom < 9.5) {
    return tree.densityCells.filter((cell) =>
      cell?.bounds && nodeCount(cell) > 0 && intersectsQtctBounds(cell.bounds, view));
  }
  const partitions = [];
  collectViewportPartitions(tree, view, targetDepthForZoom(normalizedZoom), partitions);
  return partitions
    .filter((node) => node?.bounds && nodeCount(node) > 0
      && (normalizedZoom < 9.5 || !node.stub))
    .map((node) => ({
      bounds: node.bounds,
      count: nodeCount(node),
      depth: Number(node.depth) || 0,
      representative: node.representative || null,
    }));
};

// Adds one pin for every density-limit records and distributes them by branch weight.
const allocatePinQuota = (nodes, quota) => {
  const allocations = nodes.map(() => 0);
  for (let seat = 0; seat < quota; seat += 1) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      const count = nodeCount(nodes[index]);
      if (allocations[index] >= count) continue;
      const score = count / (allocations[index] + 1);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    allocations[bestIndex] += 1;
  }
  return allocations;
};

const emitDensityRepresentatives = (node, view, quota, out) => {
  if (!node || quota <= 0 || !intersectsQtctBounds(node.bounds, view)) return;
  const children = (node.children || []).filter((child) => intersectsQtctBounds(child.bounds, view));
  if (quota === 1 || children.length === 0) {
    if (node.representative) out.push(node.representative);
    return;
  }
  const allocations = allocatePinQuota(children, quota);
  children.forEach((child, index) => emitDensityRepresentatives(child, view, allocations[index], out));
};

const collectVisible = (node, view, targetDepth, out, showIndividuals, densityLimit) => {
  if (!node || !intersectsQtctBounds(node.bounds, view)) return;
  if (!showIndividuals) {
    const partitions = [];
    collectViewportPartitions(node, view, targetDepth, partitions);
    const visibleCount = partitions.reduce((sum, partition) => sum + nodeCount(partition), 0);
    const pinQuota = Math.max(1, Math.ceil(visibleCount / densityLimit));
    const allocations = allocatePinQuota(partitions, pinQuota);
    partitions.forEach((partition, index) =>
      emitDensityRepresentatives(partition, view, allocations[index], out));
    return;
  }
  if (!node.children?.length || node.depth >= targetDepth) {
    if (Array.isArray(node.records)) {
      for (const record of node.records) {
        if (record.lon >= view.x && record.lon <= view.x + view.width &&
          record.lat >= view.y && record.lat <= view.y + view.height) {
          out.push({ ...record, representative: false, count: 1 });
        }
      }
    } else if (node.representative) {
      out.push(node.representative);
    }
    return;
  }
  node.children.forEach((child) =>
    collectVisible(child, view, targetDepth, out, true, densityLimit));
};

export const zoomForGeoView = (view) => {
  const width = Number(view?.width);
  return Number.isFinite(width) && width > 0 ? Math.log2(360 / width) : 8;
};

export const selectQtctFeatures = ({
  tree,
  view,
  zoom = zoomForGeoView(view),
  individualZoom = 13,
} = {}) => {
  if (!tree || !view) return [];
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : zoomForGeoView(view);
  const out = [];
  collectVisible(
    tree,
    view,
    targetDepthForZoom(normalizedZoom),
    out,
    normalizedZoom >= Number(individualZoom || 13),
    densityLimitForZoom(normalizedZoom),
  );
  return out.filter(Boolean);
};
