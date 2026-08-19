const classTokens = (layer) => new Set(
  String(layer?.className || '').split(/\s+/).filter(Boolean),
);

export const deactivateVisibleSwitchPeers = (layer, peers, visibleLayerIds) => {
  if (!layer?.visible) return [];
  const tokens = classTokens(layer);
  if (!tokens.has('switch')) return [];

  const groups = [...tokens].filter((token) => token !== 'switch');
  if (groups.length === 0) return [];

  const deactivated = [];
  for (const peer of peers || []) {
    if (!peer?.visible || peer.id === layer.id) continue;
    const peerTokens = classTokens(peer);
    if (!peerTokens.has('switch') || !groups.some((token) => peerTokens.has(token))) continue;
    peer.visible = false;
    if (peer.attrs) peer.attrs.visibility = 'hidden';
    visibleLayerIds?.delete(peer.id);
    deactivated.push(peer);
  }
  return deactivated;
};
