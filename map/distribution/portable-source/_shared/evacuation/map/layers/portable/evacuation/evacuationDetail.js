const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const STATUS = {
  open: { label: '開設中', color: '#16803c' },
  limited: { label: '要確認', color: '#b45309' },
  full: { label: '満員', color: '#b91c1c' },
  closed: { label: '閉鎖', color: '#64748b' },
  unknown: { label: '情報なし', color: '#64748b' },
};

export const renderEvacuationDetail = (feature) => {
  const status = STATUS[feature.status] || STATUS.unknown;
  const statusMarkup = feature.representative
    ? `
        <div class="svg3-property-status">
          <span>代表地点：${escapeHtml(feature.count || 0)}件</span>
        </div>
      `
    : `
        <div class="svg3-property-status" style="color:${status.color};">
          <span class="svg3-property-dot"></span>
          <span>${escapeHtml(status.label)}</span>
        </div>
      `;
  const rows = [
    ['住所', feature.address],
    ['施設概要', feature.summary || feature.description],
    ['地区', feature.area],
    ['運営者', feature.operator],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  const items = Array.isArray(feature.items) ? feature.items : [];

  return `
    <article class="svg3-property svg3-property-evacuation">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">避難所</p>
        <h2 class="svg3-property-title">${escapeHtml(feature.title || '避難所')}</h2>
        ${statusMarkup}
      </header>
      <dl class="svg3-property-body">
        ${rows.map(([label, value]) => `
          <div class="svg3-property-row">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('')}
      </dl>
      ${items.length > 0 ? `
        <section class="svg3-property-list">
          <h3>避難所一覧</h3>
          <ul>
            ${items.map((item) => `
              <li>
                <strong>${escapeHtml(item.title)}</strong>
                ${item.address ? `<small>${escapeHtml(item.address)}</small>` : ''}
              </li>
            `).join('')}
          </ul>
        </section>
      ` : ''}
    </article>
  `;
};
