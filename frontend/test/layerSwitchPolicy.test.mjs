import assert from 'node:assert/strict';
import test from 'node:test';

import { deactivateVisibleSwitchPeers } from '../../map/webapp/shared/layerSwitchPolicy.js';

test('追加する背景は同じswitchグループの表示中レイヤーを解除する', () => {
  const current = {
    id: 'managed-basemap',
    className: 'basemap switch',
    visible: true,
    attrs: { visibility: 'visible' },
  };
  const imported = {
    id: 'community-basemap',
    className: 'basemap switch',
    visible: true,
    attrs: { visibility: 'visible' },
  };
  const visible = new Set([current.id]);

  assert.deepEqual(deactivateVisibleSwitchPeers(imported, [current], visible), [current]);
  assert.equal(current.visible, false);
  assert.equal(current.attrs.visibility, 'hidden');
  assert.equal(visible.has(current.id), false);
});

test('異なるswitchグループとswitchでないレイヤーは解除しない', () => {
  const imported = { id: 'new', className: 'basemap switch', visible: true };
  const peers = [
    { id: 'overlay', className: 'overlay switch', visible: true },
    { id: 'hazard', className: 'basemap', visible: true },
  ];

  assert.deepEqual(deactivateVisibleSwitchPeers(imported, peers, new Set()), []);
  assert.equal(peers.every((peer) => peer.visible), true);
});
