const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const STATUS = {
  normal: { label: '平常', color: '#1d7f5b' },
  advisory: { label: '氾濫注意', color: '#d97706' },
  evacuation: { label: '避難判断', color: '#dc2626' },
  danger: { label: '氾濫危険', color: '#991b1b' },
  stale: { label: '更新遅延', color: '#64748b' },
  unknown: { label: '欠測', color: '#475569' },
};

const text = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
};

const numberText = (value, unit = '') => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number.toFixed(2)}${unit ? ` ${unit}` : ''}`;
};

const changeText = (value, unit = '') => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const sign = number > 0 ? '+' : '';
  const arrow = number > 0 ? ' ↑' : number < 0 ? ' ↓' : '';
  return `${sign}${number.toFixed(2)}${unit ? ` ${unit}` : ''}${arrow}`;
};

const relativeObservedAt = (observedAt) => {
  const time = Date.parse(observedAt || '');
  if (!Number.isFinite(time)) return '';
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}分前に観測`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours}時間${minutes ? `${minutes}分` : ''}前に観測`;
};

export const renderRiverLevelDetail = (feature) => {
  const props = feature.properties || {};
  const status = STATUS[feature.status] || STATUS.unknown;
  const unit = text(props.unit, 'm');
  const rows = [
    ['河川', props.river],
    ['設置場所', props.location || feature.address],
    ['現在水位', numberText(props.currentLevel, unit)],
    ['1時間変化', changeText(props.change1h, unit)],
    ['氾濫注意水位', numberText(props.advisoryLevel, unit)],
    ['避難判断水位', numberText(props.evacuationLevel, unit)],
    ['氾濫危険水位', numberText(props.dangerLevel, unit)],
    ['観測時刻', props.observedAt],
    ['データ状態', props.quality],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');

  return `
    <article class="svg3-property svg3-property-evacuation">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">河川水位</p>
        <h2 class="svg3-property-title">${escapeHtml(feature.title || '水位観測所')}</h2>
        <div class="svg3-property-status" style="color:${status.color};">
          <span class="svg3-property-dot"></span>
          <span>${feature.representative ? `代表地点：${escapeHtml(feature.count || 0)}件` : escapeHtml(status.label)}</span>
        </div>
        ${props.observedAt ? `<p class="svg3-property-subtitle">${escapeHtml(relativeObservedAt(props.observedAt))}</p>` : ''}
      </header>
      <dl class="svg3-property-body">
        ${rows.map(([label, value]) => `
          <div class="svg3-property-row">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('')}
      </dl>
      ${props.sourceUrl ? `
        <div class="svg3-property-actions">
          <a class="svg3-property-link" href="${escapeHtml(props.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式ページ</a>
        </div>
      ` : ''}
    </article>
  `;
};
