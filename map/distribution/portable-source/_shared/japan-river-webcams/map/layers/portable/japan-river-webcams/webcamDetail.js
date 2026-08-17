const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const allowedImageUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['cam.river.go.jp', 'www.river.go.jp'].includes(url.hostname)
      ? url.href
      : '';
  } catch {
    return '';
  }
};

/**
 * 公式ページの URL。元データ (river.go.jp) のものだけを通す。
 * 空文字を href に入れると現在のページを開き直すだけになり、利用者には
 * 「公式ページが開けない」ではなく「地図が再読み込みされた」に見える。
 */
const allowedPageUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['www.river.go.jp', 'river.go.jp'].includes(url.hostname)
      ? url.href
      : '';
  } catch {
    return '';
  }
};

export const renderWebcamDetail = (feature, { imageEnabled = false } = {}) => {
  const imageUrl = allowedImageUrl(feature.imageUrl);
  const pageUrl = allowedPageUrl(feature.pageUrl);
  const showImage = Boolean(imageUrl && imageEnabled);
  return `
  <article class="svg3-property svg3-property-evacuation svg3-property-webcam-compact">
    <header class="svg3-property-header">
      <p class="svg3-property-kind">河川監視カメラ</p>
      <h2 class="svg3-property-title">${escapeHtml(feature.title || 'Webカメラ')}</h2>
      <div class="svg3-property-status">
        <span>${feature.representative ? `代表地点：${escapeHtml(feature.count || 0)}件` : '公式情報'}</span>
      </div>
    </header>
    <dl class="svg3-property-body">
      <div class="svg3-property-row">
        <dt>設置場所</dt>
        <dd>${escapeHtml(feature.location || '')}</dd>
      </div>
      ${feature.river ? `
        <div class="svg3-property-row">
          <dt>河川</dt>
          <dd>${escapeHtml(feature.river)}</dd>
        </div>
      ` : ''}
      <div class="svg3-property-row">
        <dt>提供元</dt>
        <dd>${escapeHtml(feature.provider || '')}</dd>
      </div>
      <div class="svg3-property-row">
        <dt>出典</dt>
        <dd>国土交通省「川の防災情報」</dd>
      </div>
      <div class="svg3-property-row svg3-property-media-row">
        <dt>カメラ画像</dt>
        <dd data-slawa-media>
          ${showImage ? `
            <figure class="svg3-property-media">
              <img
                data-webcam-image
                data-source="${escapeHtml(imageUrl)}"
                data-slawa-media-source="${escapeHtml(imageUrl)}"
                src="${escapeHtml(imageUrl)}"
                alt="${escapeHtml(feature.title || '河川監視カメラ')}"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
                referrerpolicy="no-referrer"
              >
            </figure>
            <small class="svg3-property-media-status" data-webcam-status data-slawa-media-status>画像を取得中</small>
            <small class="svg3-property-media-status" data-webcam-captured-at>撮影時刻：確認できません</small>
            <small class="svg3-property-media-status">第三者配信元から利用者操作時に直接取得します</small>
          ` : imageUrl ? '<small class="svg3-property-media-status" data-webcam-status>画像表示は停止中です。公式ページで確認してください</small>' : ''}
          <div class="svg3-property-actions">
            ${showImage ? '<button type="button" data-webcam-refresh data-slawa-action="refresh-image" data-slawa-cooldown-ms="30000">画像を更新</button>' : ''}
            ${pageUrl
              ? `<a class="svg3-property-link" href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer">公式ページ</a>`
              : '<span class="svg3-property-link-missing" data-webcam-page-missing>公式URLを取得できません</span>'}
          </div>
        </dd>
      </div>
    </dl>
  </article>
`;
};
