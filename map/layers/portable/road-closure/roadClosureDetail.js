const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const STATUS = {
  closed: { label: '通行止め', color: '#b91c1c' },
  flooded: { label: '冠水', color: '#2563eb' },
  restricted: { label: '規制中', color: '#d97706' },
  cleared: { label: '解除', color: '#16803c' },
  unknown: { label: '不明', color: '#475569' },
};

const text = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const renderRoadClosureDetail = (feature) => {
  const props = feature.properties || {};
  const status = STATUS[feature.status] || STATUS.unknown;
  const rows = [
    ['道路名', props.roadName],
    ['区間', props.section],
    ['原因', props.reason],
    ['開始', props.startedAt],
    ['更新', props.updatedAt],
    ['確認者', props.reporter],
    ['備考', props.note],
  ].filter(([, value]) => text(value));

  return `
    <article class="svg3-property svg3-property-evacuation">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">道路通行情報</p>
        <h2 class="svg3-property-title">${escapeHtml(feature.title || '道路規制')}</h2>
        <div class="svg3-property-status" style="color:${status.color};">
          <span class="svg3-property-dot"></span>
          <span>${feature.representative ? `代表地点：${escapeHtml(feature.count || 0)}件` : escapeHtml(status.label)}</span>
        </div>
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
          <a class="svg3-property-link" href="${escapeHtml(props.sourceUrl)}" target="_blank" rel="noopener noreferrer">情報元</a>
        </div>
      ` : ''}
    </article>
  `;
};
