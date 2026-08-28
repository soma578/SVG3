const HEALTH_STATUSES = new Set(['healthy', 'stale', 'error']);

export const validateLayerHealth = (health, layerId) => (
  health?.schemaVersion === 1
  && health.layerId === layerId
  && HEALTH_STATUSES.has(health.status)
  && (!health.staleAfterAt || Number.isFinite(Date.parse(health.staleAfterAt)))
);

export const layerHealthStatus = (health, now = Date.now()) => {
  if (!health) return { status: 'pending', label: '確認中' };
  if (health.unavailable) return { status: 'unknown', label: '状態不明' };
  if (health.status === 'error') return { status: 'error', label: '取得失敗' };
  const staleAt = Date.parse(health.staleAfterAt || '');
  if (health.status === 'stale' || (Number.isFinite(staleAt) && now > staleAt)) {
    return { status: 'stale', label: '期限切れ' };
  }
  return { status: 'healthy', label: '最新' };
};

export const formatHealthDate = (value) => {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '記録なし';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

export const healthDescription = (health, display) => {
  if (!health || health.unavailable) return display.label;
  return `${display.label}・最終成功 ${
    health.lastSuccessAt ? formatHealthDate(health.lastSuccessAt) : '成功履歴なし'
  }`;
};

export const healthDeliveryLabel = (delivery) => ({
  'scheduled-snapshot': '定期スナップショット',
  'static-snapshot': '静的スナップショット',
  'controlled-direct': '取得間隔を制御して直接取得',
  'user-action-direct': '操作時のみ直接取得',
})[delivery] || delivery || '未指定';

const appendDetailRow = (list, label, value, documentRef) => {
  const term = documentRef.createElement('dt');
  term.textContent = label;
  const description = documentRef.createElement('dd');
  const NodeType = documentRef.defaultView?.Node;
  if (NodeType && value instanceof NodeType) description.append(value);
  else description.textContent = String(value || '記録なし');
  list.append(term, description);
};

export const createLayerHealthDetail = (layer, display, documentRef = document) => {
  const health = layer.healthData;
  const source = layer.dataSource || {};
  const detail = documentRef.createElement('div');
  detail.className = 'layer-health-detail';
  detail.hidden = true;
  const list = documentRef.createElement('dl');
  const authorityUrl = String(source.authority?.url || '');

  if (source.authority?.name && /^https:\/\//i.test(authorityUrl)) {
    const authority = documentRef.createElement('a');
    authority.href = authorityUrl;
    authority.target = '_blank';
    authority.rel = 'noopener noreferrer';
    authority.textContent = source.authority.name;
    appendDetailRow(list, '出典', authority, documentRef);
  } else {
    appendDetailRow(list, '出典', source.authority?.name || '未指定', documentRef);
  }

  appendDetailRow(list, '配信方式', healthDeliveryLabel(source.delivery), documentRef);
  appendDetailRow(
    list,
    '閲覧時取得',
    source.runtimeFetch ? '参照元へアクセスします' : '参照元へ自動アクセスしません',
    documentRef,
  );
  appendDetailRow(list, '状態', display.label, documentRef);
  appendDetailRow(list, '最終成功', formatHealthDate(health?.lastSuccessAt), documentRef);
  appendDetailRow(list, 'データ更新', formatHealthDate(health?.snapshotUpdatedAt), documentRef);
  appendDetailRow(list, '有効期限', formatHealthDate(health?.staleAfterAt), documentRef);
  appendDetailRow(list, '次回目安', formatHealthDate(health?.nextScheduledAt), documentRef);
  if (health?.recordCount != null && Number.isFinite(Number(health.recordCount))) {
    appendDetailRow(list, '収録件数', `${Number(health.recordCount).toLocaleString('ja-JP')}件`, documentRef);
  }
  if (health?.lastError) appendDetailRow(list, '失敗理由', health.lastError, documentRef);
  if (health?.unavailable) {
    appendDetailRow(list, '確認結果', '更新状態を取得できませんでした', documentRef);
  }

  detail.append(list);
  return detail;
};

export const loadLayerHealthData = async ({ layers, fetchJson }) => {
  const healthLayers = layers.filter((layer) => layer.health);
  const fetches = new Map();
  for (const layer of healthLayers) {
    if (!fetches.has(layer.health)) {
      fetches.set(layer.health, fetchJson(layer.health, { cache: 'no-store' }));
    }
  }
  await Promise.all(healthLayers.map(async (layer) => {
    try {
      const health = await fetches.get(layer.health);
      if (!validateLayerHealth(health, layer.id)) throw new Error('health manifestが不正です');
      layer.healthData = health;
    } catch (error) {
      console.warn('[layer-health] source health unavailable', layer.health, error);
      layer.healthData = { unavailable: true };
    }
  }));
  return healthLayers;
};
