const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const LEVELS = {
  emergency: { label: '特別警報', color: '#5b2386' },
  warning: { label: '警報', color: '#c62828' },
  advisory: { label: '注意報', color: '#b26a00' },
  unknown: { label: '未知の種別', color: '#59636e' },
};

const datetimeLabel = (value) => {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(time));
};

export const renderFloodWarningDetail = (feature) => {
  const level = LEVELS[feature.status] || LEVELS.unknown;
  const kinds = Array.isArray(feature.kinds) ? feature.kinds : [];
  return `
    <article class="svg3-property svg3-property-evacuation" style="--property-accent:${level.color};">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">気象庁　気象警報・注意報</p>
        <h2 class="svg3-property-title">${escapeHtml(feature.title || '市区町村')}</h2>
        <div class="svg3-property-status">
          <span class="svg3-property-dot"></span><span>${escapeHtml(level.label)}</span>
        </div>
      </header>
      <dl class="svg3-property-body">
        <div class="svg3-property-row">
          <dt>発表中</dt>
          <dd>${kinds.length
            ? kinds.map((kind) => escapeHtml(kind.name)).join('<br>')
            : escapeHtml(feature.summary || '詳細不明')}</dd>
        </div>
        ${feature.observedAt ? `
          <div class="svg3-property-row">
            <dt>発表時刻</dt>
            <dd>${escapeHtml(datetimeLabel(feature.observedAt))}</dd>
          </div>` : ''}
        <div class="svg3-property-row">
          <dt>注意</dt>
          <dd>これは観測所の水位ではなく、市区町村単位の気象警報・注意報です。</dd>
        </div>
      </dl>
      <div class="svg3-property-actions" style="padding:0 20px 16px;">
        <a class="svg3-property-link" href="https://www.jma.go.jp/bosai/map.html#contents=warning" target="_blank" rel="noopener noreferrer">気象庁で確認</a>
      </div>
    </article>`;
};
