/**
 * ピンレイヤープロファイル
 * ========================
 * representativePinsLayer.html は純粋な描画エンジン (QTCT 読込 → カリング → <use> 描画 →
 * hitTargets 通知) であり、レイヤー固有のビジネスルールはすべてこのファイルに宣言する。
 * エンジン本体に `layerId === '...'` の分岐を書いてはならない。
 *
 * 新しいピンレイヤーの追加手順:
 *   1. ここにプロファイルを1エントリ足す
 *   2. managed layer.config.json に portable entrypoint と build を宣言する
 *   Container/QTCTは map:build が自動生成する。エンジン本体の変更は不要。
 *
 * フィールド:
 *   label                データステータス通知に使う表示名
 *   statusAliases        { 正規status: [生statusの別名...] } 正規キー自身もマッチする
 *   defaultStatus        どの別名にも一致しない生statusの正規化先
 *   icons                { 正規status: アイコンhref } ensureIconDefs はこのキー集合で defs を作る
 *   representativeStatus クラスタ代表ピンを常にこのstatusで描く (null = 個別と同じ正規化)
 *   placement            'point' = lat/lon をそのまま使う
 *                        'districtCentroid' = municipalityCode の地区ポリゴン重心に置き直す
 *   individualKind       featurePayload の kind (非代表ピン)
 *   individualZoom       個別ピン表示へ切り替えるズーム。未指定なら 12
 *
 * representative.count はcore共通の密度表示に使われる。
 * ズーム別閾値1単位につき、同じ大きさ・濃さの代表ピンが1本表示される。
 */
export const PIN_LAYER_PROFILES = {
  generic: {
    label: '汎用ピン',
    statusAliases: {
      normal: ['normal', 'active', 'available', 'open', '平常'],
      unknown: ['unknown', '不明', '欠測'],
    },
    defaultStatus: 'normal',
    icons: {
      normal: '../../../icons/river-level-normal.svg',
      unknown: '../../../icons/river-level-unknown.svg',
    },
    representativeStatus: null,
    placement: 'point',
    individualKind: 'poi',
  },
  evacuation: {
    label: '避難所代表ピン',
    statusAliases: {
      open: ['open', 'opened', 'active', 'available', '利用可', '開設中'],
      limited: ['limited', 'crowded', 'near_full', '要確認'],
      full: ['full', '満員'],
      closed: ['closed', 'close', 'inactive', '閉鎖'],
    },
    defaultStatus: 'unknown',
    icons: {
      open: '../../../icons/shelter-open.png',
      limited: '../../../icons/shelter-limited.png',
      full: '../../../icons/shelter-full.png',
      closed: '../../../icons/shelter-closed.png',
      unknown: '../../../icons/shelter-default.png',
    },
    representativeStatus: 'open',
    placement: 'point',
    individualKind: 'poi',
  },
  teamActivity: {
    label: '活動情報代表ピン',
    statusAliases: {
      active: ['open', 'opened', 'active', 'available', '利用可', '開設中'],
      limited: ['limited', 'crowded', 'near_full', '要確認'],
      full: ['full', '満員'],
      unknown: ['closed', 'close', 'inactive', '閉鎖'],
      standby: ['standby', 'waiting', '待機中'],
      planned: ['planned', 'scheduled', 'plan', '予定', '計画中'],
      completed: ['completed', 'complete', 'done', '完了'],
      needs_attention: ['needs_attention', 'warning', 'alert', '要対応'],
    },
    defaultStatus: 'active',
    icons: {
      active: '../../../icons/team-active.png',
      // limited / full は専用アイコン未定義のため active と同じ (旧 iconHrefFor の
      // フォールスルーと同値)
      limited: '../../../icons/team-active.png',
      full: '../../../icons/team-active.png',
      standby: '../../../icons/team-standby.png',
      planned: '../../../icons/team-planned.png',
      completed: '../../../icons/team-completed.png',
      needs_attention: '../../../icons/team-attention.png',
      unknown: '../../../icons/team-attention.png',
    },
    representativeStatus: null,
    placement: 'districtCentroid',
    individualKind: 'activity-marker',
  },
  japanRiverWebcam: {
    label: '河川監視カメラ',
    statusAliases: {
      available: ['available', 'active', 'open', '公式情報'],
      unknown: ['unknown'],
    },
    defaultStatus: 'available',
    icons: {
      available: '../../../icons/river-webcam.svg',
      unknown: '../../../icons/river-webcam.svg',
    },
    representativeStatus: 'available',
    placement: 'point',
    individualKind: 'webcam',
    individualZoom: 13,
  },
  riverLevel: {
    label: '河川水位',
    statusAliases: {
      normal: ['normal', '平常'],
      advisory: ['advisory', '氾濫注意'],
      evacuation: ['evacuation', '避難判断'],
      danger: ['danger', '氾濫危険'],
      stale: ['stale', '更新停止', '遅延'],
      unknown: ['unknown', '欠測', '不明'],
    },
    defaultStatus: 'unknown',
    icons: {
      normal: '../../../icons/river-level-normal.svg',
      advisory: '../../../icons/river-level-advisory.svg',
      evacuation: '../../../icons/river-level-evacuation.svg',
      danger: '../../../icons/river-level-danger.svg',
      stale: '../../../icons/river-level-stale.svg',
      unknown: '../../../icons/river-level-unknown.svg',
    },
    representativeStatus: null,
    placement: 'point',
    individualKind: 'river-gauge',
    // 観測から20分を過ぎた値は「現在の危険段階」として扱わない。
    // (managed/river-level の dataSource.freshness.staleAfterMinutes と同値)
    observationStaleAfterMinutes: 20,
    expiredStatus: 'stale',
  },
  roadClosure: {
    label: '道路通行情報',
    statusAliases: {
      closed: ['closed', '通行止め', '通行止', '規制'],
      flooded: ['flooded', '冠水'],
      restricted: ['restricted', '片側交互通行', '規制中'],
      cleared: ['cleared', '解除', '復旧'],
      unknown: ['unknown', '不明'],
    },
    defaultStatus: 'unknown',
    icons: {
      closed: '../../../icons/road-closure-closed.svg',
      flooded: '../../../icons/road-closure-flooded.svg',
      restricted: '../../../icons/road-closure-restricted.svg',
      cleared: '../../../icons/road-closure-cleared.svg',
      unknown: '../../../icons/road-closure-unknown.svg',
    },
    representativeStatus: null,
    placement: 'point',
    individualKind: 'road-closure',
  },
};

const mergeStatusAliases = (base = {}, override = {}) => ({
  ...base,
  ...override,
});

export const resolvePinProfile = (layerId, override = null) => {
  const base = PIN_LAYER_PROFILES[layerId] || PIN_LAYER_PROFILES.generic;
  if (!override || typeof override !== 'object') return base;
  const wantsGeneratedIcons = Boolean(
    override.iconMode === 'generated' ||
    override.color ||
    override.symbol ||
    override.statusColors,
  );
  const profile = {
    ...base,
    ...override,
    statusAliases: mergeStatusAliases(base.statusAliases, override.statusAliases),
    icons: {
      ...(base.icons || {}),
      ...(override.icons || {}),
    },
    statusColors: {
      ...(base.statusColors || {}),
      ...(override.statusColors || {}),
    },
    statusLabels: {
      ...(base.statusLabels || {}),
      ...(override.statusLabels || {}),
    },
  };
  for (const status of Object.keys(profile.statusAliases || {})) {
    if (!(status in profile.icons)) profile.icons[status] = '';
    if (wantsGeneratedIcons && !(override.icons && status in override.icons)) profile.icons[status] = '';
  }
  for (const status of Object.keys(profile.statusColors || {})) {
    if (!(status in profile.icons)) profile.icons[status] = '';
    if (wantsGeneratedIcons && !(override.icons && status in override.icons)) profile.icons[status] = '';
  }
  return profile;
};
