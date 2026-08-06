const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const STATUS = {
  active: { label: '活動中', color: '#16803c' },
  standby: { label: '待機中', color: '#b45309' },
  planned: { label: '対応予定', color: '#c2410c' },
  completed: { label: '完了', color: '#64748b' },
  needs_attention: { label: '要確認', color: '#b91c1c' },
  unknown: { label: '情報なし', color: '#64748b' },
};

export const renderTeamActivityDetail = (feature) => {
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
    ['活動概要', feature.summary || feature.description],
    ['担当地区', feature.area],
    ['運営者', feature.operator],
    ['自治体コード', feature.municipalityCode],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  const items = Array.isArray(feature.items) ? feature.items : [];

  return `
    <article class="svg3-property svg3-property-team">
      <header class="svg3-property-header">
        <p class="svg3-property-kind">チーム活動</p>
        <h2 class="svg3-property-title">${escapeHtml(feature.title || 'チーム活動')}</h2>
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
          <h3>活動一覧</h3>
          <ul>
            ${items.map((item) => `
              <li>
                <strong>${escapeHtml(item.title)}</strong>
                ${item.summary ? `<small>${escapeHtml(item.summary)}</small>` : ''}
              </li>
            `).join('')}
          </ul>
        </section>
      ` : ''}
    </article>
  `;
};
