const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const LEVELS = {
  emergency: { label: '特別警報', color: '#5b2386', icon: new URL('./warning-emergency.svg', import.meta.url).href },
  warning: { label: '警報', color: '#c62828', icon: new URL('./warning-warning.svg', import.meta.url).href },
  advisory: { label: '注意報', color: '#a95f00', icon: new URL('./warning-advisory.svg', import.meta.url).href },
  unknown: { label: '種別不明', color: '#59636e', icon: new URL('./warning-unknown.svg', import.meta.url).href },
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
    <article class="svg3-property svg3-property-warning" style="--property-accent:${level.color};">
      <header class="svg3-property-header">
        <div class="svg3-property-heading">
          <img class="svg3-property-heading-icon" src="${level.icon}" alt="" width="34" height="34">
          <div>
            <p class="svg3-property-kind">気象警報・注意報</p>
            <h2 class="svg3-property-title">${escapeHtml(feature.title || '市区町村')}</h2>
          </div>
        </div>
        <div class="svg3-property-status">
          <span class="svg3-property-dot"></span><span>${escapeHtml(level.label)}</span>
        </div>
      </header>
      <dl class="svg3-property-body">
        <div class="svg3-property-row">
          <dt>発表中</dt>
          <dd>${kinds.length ? `<ul class="svg3-property-warning-list">${kinds.map((kind) => {
            const kindLevel = LEVELS[kind.level] || LEVELS.unknown;
            return `<li style="--warning-color:${kindLevel.color}">${escapeHtml(kind.name)}</li>`;
          }).join('')}</ul>` : escapeHtml(feature.summary || '詳細不明')}</dd>
        </div>
        ${feature.observedAt ? `
          <div class="svg3-property-row">
            <dt>発表時刻</dt>
            <dd>${escapeHtml(datetimeLabel(feature.observedAt))}</dd>
          </div>` : ''}
        ${feature.municipalityCode ? `
          <div class="svg3-property-row">
            <dt>対象区域コード</dt>
            <dd>${escapeHtml(feature.municipalityCode)}</dd>
          </div>` : ''}
        <div class="svg3-property-row">
          <dt>情報提供</dt>
          <dd>気象庁</dd>
        </div>
      </dl>
      <div class="svg3-property-actions svg3-property-actions-padded">
        <a class="svg3-property-link" href="https://www.jma.go.jp/bosai/map.html#contents=warning" target="_blank" rel="noopener noreferrer">気象庁で確認</a>
      </div>
    </article>`;
};
