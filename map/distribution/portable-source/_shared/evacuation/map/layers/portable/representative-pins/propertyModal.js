const PROPERTY_STYLES = `
  <style>
    .svg3-property {
      --property-accent: #315b8a;
      --property-accent-soft: #edf4fb;
      color: #172033;
      font-family: "Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.45;
    }
    .svg3-property-evacuation {
      --property-accent: #177245;
      --property-accent-soft: #eaf7f0;
    }
    .svg3-property-team {
      --property-accent: #245db5;
      --property-accent-soft: #edf3ff;
    }
    .svg3-property-header {
      padding: 14px 46px 13px 17px;
      background: var(--property-accent);
      color: #ffffff;
    }
    .svg3-property-kind {
      margin: 0 0 6px;
      color: rgba(255, 255, 255, 0.76);
      font-size: 14px;
      font-weight: 700;
    }
    .svg3-property-title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: 0;
    }
    .svg3-property-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 8px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff !important;
      font-size: 14px;
      font-weight: 700;
    }
    .svg3-property-dot {
      display: block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .svg3-property-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      margin: 0;
      padding: 7px 17px 9px;
      background: #ffffff;
    }
    .svg3-property-row {
      min-width: 0;
      padding: 7px 0;
      border-bottom: 1px solid #edf1f2;
    }
    .svg3-property-row dt {
      color: var(--property-accent);
      font-size: 14px;
      font-weight: 700;
    }
    .svg3-property-row dd {
      margin: 2px 0 0;
      color: #253044;
      font-size: 15px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .svg3-property-link {
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      padding: 7px 13px;
      border-radius: 6px;
      background: var(--property-accent);
      color: #ffffff !important;
      font-weight: 700;
      text-decoration: none;
    }
    .svg3-property-media {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      margin: 6px 0 8px;
      overflow: hidden;
      border-radius: 6px;
      background: #e8eeee;
    }
    .svg3-property-media img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .svg3-property-media-status {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 15px;
    }
    .svg3-property-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
      margin-top: 8px;
    }
    .svg3-property-actions button,
    .svg3-property-actions .svg3-property-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 44px;
      padding: 7px 10px;
      border: 1px solid var(--property-accent);
      border-radius: 6px;
      box-sizing: border-box;
      font: inherit;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .svg3-property-actions button {
      background: #ffffff;
      color: var(--property-accent);
    }
    .svg3-property-actions > :only-child {
      grid-column: 1 / -1;
    }
    .svg3-property-webcam-compact .svg3-property-header {
      padding: 12px 48px 11px 16px;
    }
    .svg3-property-webcam-compact .svg3-property-kind {
      margin-bottom: 3px;
    }
    .svg3-property-webcam-compact .svg3-property-status {
      margin-top: 5px;
    }
    .svg3-property-webcam-compact .svg3-property-body {
      padding: 4px 16px 6px;
    }
    .svg3-property-webcam-compact .svg3-property-row {
      padding: 5px 0;
    }
    .svg3-property-webcam-compact .svg3-property-row dd {
      margin-top: 1px;
    }
    .svg3-property-webcam-compact .svg3-property-media-row dd {
      white-space: normal;
    }
    .svg3-property-webcam-compact .svg3-property-media {
      aspect-ratio: 4 / 3;
      margin: 4px 0 5px;
    }
    .svg3-property-webcam-compact .svg3-property-actions {
      margin-top: 5px;
    }
    .svg3-property-list {
      padding: 0 20px 14px;
      background: #ffffff;
    }
    .svg3-property-list h3 {
      margin: 0 0 5px;
      color: var(--property-accent);
      font-size: 18px;
    }
    .svg3-property-list ul {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .svg3-property-list li {
      min-width: 180px;
      font-size: 15px;
    }
    .svg3-property-list small {
      display: block;
      color: #64748b;
    }
    .svg3-property-attribution {
      margin: 0;
      padding: 8px 17px 10px;
      border-top: 1px solid #e6ebef;
      background: #f7f9fa;
      color: #607078;
      font-size: 12px;
      line-height: 1.45;
    }
    .svg3-property-attribution strong {
      margin-right: 0.45em;
      color: #34454d;
    }
    .svg3-property-attribution a {
      color: #245b88;
      overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
      .svg3-property {
        font-size: 15px;
      }
      .svg3-property-header {
        padding: 15px 58px 13px 16px;
      }
      .svg3-property-title {
        font-size: 18px;
      }
      .svg3-property-body {
        padding: 7px 16px 8px;
      }
      .svg3-property-row {
        padding: 6px 10px 6px 0;
      }
      .svg3-property-list {
        padding: 0 16px 12px;
      }
      .svg3-property-actions button,
      .svg3-property-actions .svg3-property-link {
        min-height: 44px;
      }
      .svg3-property-list li {
        min-width: min(180px, 100%);
      }
    }
  </style>
`;

const setStyles = (element, styles) => {
  if (!element?.style) return;
  Object.assign(element.style, styles);
};

const findModalCloseButton = (root) => {
  if (!root) return null;
  for (const child of root.children || []) {
    if (child?.tagName?.toLowerCase?.() === 'button') return child;
  }
  return null;
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const attributionMarkup = (attribution) => {
  const label = String(attribution?.label || '').trim();
  if (!label) return '';
  let url = '';
  try {
    const parsed = new URL(String(attribution?.url || ''));
    if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href;
  } catch {
    // A label without a link is still useful attribution.
  }
  const source = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  return `<p class="svg3-property-attribution"><strong>出典</strong>${source}</p>`;
};

// 基準幅はアプリの他のUIに合わせる。候補一覧(#ticker)が最大320px、レイヤー
// 固有UIが399pxで、プロパティだけが地図を覆わないよう、本文・余白を含めて
// 従来のおよそ2/3の面積に抑える。狭い画面では従来どおりviewport幅に収める。
export const showPropertyModal = (html, { width = 260, attribution = null } = {}) => {
  if (!window.svgMap?.showModal) return null;

  const info = window.svgMap.showModal(
    `${PROPERTY_STYLES}${html}${attributionMarkup(attribution)}`,
    width,
    480,
  );
  if (!info) return null;

  const root = info.getRootNode?.();
  const host = root?.host;
  const closeButton = findModalCloseButton(root);
  const hostView = host?.ownerDocument?.defaultView || window;
  const viewportWidth = hostView.visualViewport?.width || hostView.innerWidth;
  const viewportHeight = hostView.visualViewport?.height || hostView.innerHeight;
  // 「狭いか」は幅だけで決める。Math.min(幅,高さ) で判定していたころは、
  // 横に広くても縦が短いだけでスマホ扱いになり、デスクトップでモーダルが
  // 全幅へ膨らんでいた（1536x760 で実測 1512px）。ブラウザのズームや
  // 縦の短いウィンドウで簡単に踏む。閾値はアプリ他所の 820px に合わせる。
  const NARROW_WIDTH = 820;
  const isMobile = viewportWidth <= NARROW_WIDTH;
  // 縦が詰まっているかは配置(上端位置)にだけ使い、幅には効かせない。
  const isShortViewport = viewportHeight <= 560;
  const isLandscapeMobile = isMobile && isShortViewport;
  const popupTop = isMobile ? (isLandscapeMobile ? 68 : 124) : hostView.innerWidth <= 1180 ? 140 : 84;
  const popupWidth = isMobile
    ? Math.max(240, viewportWidth - 20)
    : Math.max(240, Math.min(width, viewportWidth - 24));
  const popupMaxHeight = Math.max(180, viewportHeight - popupTop - 10);

  setStyles(info, {
    position: 'static',
    boxSizing: 'border-box',
    width: `${popupWidth}px`,
    height: 'auto',
    maxHeight: `${popupMaxHeight}px`,
    margin: '0',
    padding: '0',
    overflowX: 'hidden',
    overflowY: 'auto',
    background: '#ffffff',
    borderRadius: '12px',
  });

  setStyles(host, {
    boxSizing: 'border-box',
    position: 'absolute',
    top: `${popupTop}px`,
    bottom: 'auto',
    left: isMobile ? '10px' : '16px',
    width: `${popupWidth}px`,
    height: 'auto',
    maxWidth: 'calc(100% - 24px)',
    maxHeight: `${popupMaxHeight}px`,
    overflow: 'hidden',
    border: '1px solid rgba(15, 23, 42, 0.14)',
    borderRadius: '14px',
    background: '#ffffff',
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.24)',
  });

  const syncHeight = () => {
    const contentHeight = Math.min(info.scrollHeight, popupMaxHeight);
    setStyles(info, { height: `${contentHeight}px` });
    setStyles(host, { height: `${contentHeight}px` });
  };
  syncHeight();
  hostView.requestAnimationFrame?.(syncHeight);

  if (closeButton) {
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '詳細を閉じる');
    closeButton.title = '閉じる';
    setStyles(closeButton, {
      position: 'absolute',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '3',
      right: '10px',
      top: '9px',
      bottom: 'auto',
      width: isMobile ? '44px' : '32px',
      height: isMobile ? '44px' : '32px',
      padding: '0',
      border: '0',
      borderRadius: '0',
      background: 'transparent',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: '24px',
      lineHeight: '1',
      cursor: 'pointer',
      textShadow: '0 1px 2px rgba(15, 23, 42, 0.32)',
    });
  }

  const closeOnEscape = (event) => {
    if (event.key !== 'Escape' || !host?.isConnected) return;
    closeButton?.click?.();
    hostView.removeEventListener('keydown', closeOnEscape);
  };
  hostView.addEventListener('keydown', closeOnEscape);
  return info;
};
