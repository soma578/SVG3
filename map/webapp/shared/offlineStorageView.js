/**
 * オフライン保存状態の表示ロジック（純粋関数）
 * ============================================
 * DOM も Cache API も触らない。node:test で検証する。
 *
 * 表示は「台帳」ではなく「実キャッシュの実在確認の結果」に基づく。
 * メタデータだけ残っている地域を保存済みと言ってはいけない。
 */

const STATE_LABELS = {
  saved: '保存済み',
  incomplete: '保存未完了',
  saving: '保存中',
  failed: '保存できませんでした',
  absent: '未保存',
};

export const formatBytes = (bytes) => {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

export const formatSavedAt = (isoString, now = Date.now()) => {
  const timestamp = Date.parse(isoString || '');
  if (!Number.isFinite(timestamp)) return '保存日時不明';
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 1) return 'たった今保存';
  if (minutes < 60) return `${minutes}分前に保存`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前に保存`;
  return `${Math.floor(hours / 24)}日前に保存`;
};

/**
 * 保存済み一覧の表示行を作る。
 * progress は進行中の地域（{ regionId, stored, total }）。
 */
export const offlineRegionRows = ({
  statuses = [],
  progress = null,
  labels = {},
  now = Date.now(),
} = {}) => {
  const rows = statuses
    // 実体が無いものは一覧に出さない。
    .filter((status) => status.state === 'saved' || status.state === 'incomplete')
    .map((status) => ({
      regionId: status.regionId,
      label: labels[status.regionId] || status.regionId,
      state: status.state,
      stateLabel: STATE_LABELS[status.state],
      pinned: status.pinned === true,
      savedAtLabel: formatSavedAt(status.savedAt, now),
      bytesLabel: formatBytes(status.bytes),
      // pin 済みは自動削除されないので、その旨を出す。
      note: status.pinned
        ? '明示保存（自動削除されません）'
        : '閲覧により自動保存',
      removable: true,
    }));

  if (progress?.regionId && !rows.some((row) => row.regionId === progress.regionId)) {
    rows.unshift({
      regionId: progress.regionId,
      label: labels[progress.regionId] || progress.regionId,
      state: 'saving',
      stateLabel: STATE_LABELS.saving,
      pinned: false,
      savedAtLabel: '',
      bytesLabel: '—',
      note: `${progress.stored} / ${progress.total} 件`,
      removable: false,
    });
  } else if (progress?.regionId) {
    const row = rows.find((entry) => entry.regionId === progress.regionId);
    row.state = 'saving';
    row.stateLabel = STATE_LABELS.saving;
    row.note = `${progress.stored} / ${progress.total} 件`;
    row.removable = false;
  }

  return rows;
};

/** 保存操作の結果を利用者向けの一文にする。 */
export const cacheOutcomeMessage = (outcome, { label = '' } = {}) => {
  if (!outcome) {
    return { tone: 'error', text: 'オフライン保存を実行できませんでした' };
  }
  if (outcome.type === 'sw:capacityChoice') {
    const names = (outcome.pinnedRegions || []).join('・');
    return {
      tone: 'choice',
      text: `保存できる地域は${outcome.max}件までです。明示保存中の地域（${names}）のどれかを削除してください。`,
    };
  }
  if (outcome.type === 'sw:regionCached') {
    if (!outcome.complete) {
      return {
        tone: 'error',
        // 途中で切れたものを保存済みと言わない。
        text: `${label || outcome.regionId}の保存が完了しませんでした（${outcome.stored} / ${outcome.total} 件）。通信状況を確認して再度お試しください。`,
      };
    }
    const evicted = (outcome.evicted || []).length > 0
      ? `古い保存地域${outcome.evicted.length}件を削除しました。`
      : '';
    return {
      tone: 'ok',
      text: `${label || outcome.regionId}をオフライン用に保存しました（${formatBytes(outcome.bytes)}）。${evicted}`,
    };
  }
  return { tone: 'error', text: 'オフライン保存を実行できませんでした' };
};
