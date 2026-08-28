import { COMMUNITY_PROPERTY_CONTEXT_KEY } from './communityPropertyAdapter.js';

const INSTALL_KEY = Symbol.for('svg3.communityModalPresentationInstalled');

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const propertyContext = () => {
  const stack = window[COMMUNITY_PROPERTY_CONTEXT_KEY];
  return Array.isArray(stack) && stack.length ? stack[stack.length - 1] : null;
};

const layerTitle = (svgMap, layerId) => {
  const id = String(layerId || '');
  if (!id) return 'レイヤー情報';

  try {
    const root = svgMap?.getSvgImages?.()?.root;
    const candidates = root?.querySelectorAll?.('animation,iframe') || [];
    for (const element of candidates) {
      if (
        element.getAttribute?.('iid') === id ||
        element.getAttribute?.('id') === id
      ) {
        return element.getAttribute?.('title') || 'レイヤー情報';
      }
    }
  } catch {
    // Title lookup is only presentation metadata.
  }

  return 'レイヤー情報';
};

const isAlreadySvg3PropertyMarkup = (src) =>
  /\bsvg3-property(?:[-_\s"'])/i.test(String(src || ''));

// Some upstream property renderers prepend a generic two-column header:
//   <tr><th>name</th><th>value</th></tr>
// It is implementation scaffolding rather than domain information. Remove only
// that exact semantic header; meaningful table headings from other layers stay.
const normalizeNativePropertyMarkup = (src) => {
  const template = document.createElement('template');
  template.innerHTML = String(src ?? '');

  for (const row of template.content.querySelectorAll('tr')) {
    const cells = [...row.children].filter((cell) =>
      ['TH', 'TD'].includes(cell.tagName),
    );
    if (cells.length !== 2) continue;

    const labels = cells.map((cell) =>
      String(cell.textContent || '').trim().toLowerCase(),
    );

    if (labels[0] === 'name' && labels[1] === 'value') {
      row.remove();
      break;
    }
  }

  return template.innerHTML;
};

const NATIVE_PROPERTY_STYLES = `
<style data-svg3-community-native-property>
  .svg3-community-native-property {
    --property-accent: #315b8a;
    --property-accent-soft: #edf4fb;
    margin: 0;
    color: #172033;
    background: #ffffff;
    font-family: "Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.45;
  }
  .svg3-community-native-header {
    padding: 14px 46px 13px 17px;
    background: var(--property-accent);
    color: #ffffff;
  }
  .svg3-community-native-kind {
    margin: 0 0 6px;
    color: rgba(255,255,255,.76);
    font-size: 14px;
    font-weight: 700;
  }
  .svg3-community-native-title {
    margin: 0;
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.4;
  }
  .svg3-community-native-body {
    padding: 7px 17px 10px;
    background: #ffffff;
    overflow-wrap: anywhere;
  }
  .svg3-community-native-body table {
    width: 100% !important;
    table-layout: fixed !important;
    border: 0 !important;
    border-collapse: collapse !important;
    background: #ffffff !important;
  }
  .svg3-community-native-body tr {
    border: 0 !important;
    border-bottom: 1px solid #edf1f2 !important;
  }
  .svg3-community-native-body th,
  .svg3-community-native-body td {
    padding: 7px 0 !important;
    border: 0 !important;
    vertical-align: top !important;
    background: transparent !important;
    color: #253044 !important;
    font: inherit !important;
    overflow-wrap: anywhere;
  }
  .svg3-community-native-body th:first-child,
  .svg3-community-native-body td:first-child {
    width: 34% !important;
    padding-right: 10px !important;
    color: var(--property-accent) !important;
    font-weight: 700 !important;
  }
  .svg3-community-native-body img {
    display: block;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 4px 0 5px;
    border-radius: 6px;
    object-fit: contain;
    background: #e8eeee;
  }
  .svg3-community-native-body a {
    color: #245b88 !important;
    overflow-wrap: anywhere;
  }
  .svg3-community-native-body a:has(img) {
    display: block;
    text-decoration: none;
  }
  @media (max-width: 640px) {
    .svg3-community-native-header {
      padding: 15px 58px 13px 16px;
    }
    .svg3-community-native-body {
      padding: 7px 16px 9px;
    }
    .svg3-community-native-body th,
    .svg3-community-native-body td {
      padding: 7px 0 !important;
    }
  }
</style>`;

const wrapNativePropertyMarkup = (src, title) => `
${NATIVE_PROPERTY_STYLES}
<article class="svg3-community-native-property">
  <header class="svg3-community-native-header">
    <p class="svg3-community-native-kind">SVGMap レイヤー</p>
    <h2 class="svg3-community-native-title">${escapeHtml(title)}</h2>
  </header>
  <div class="svg3-community-native-body">${String(src ?? '')}</div>
</article>`;

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

const decorateNativePropertyModal = (info, { requestedWidth = 360 } = {}) => {
  if (!info) return null;

  const root = info.getRootNode?.();
  const host = root?.host;
  const closeButton = findModalCloseButton(root);
  const hostView = host?.ownerDocument?.defaultView || window;
  const viewportWidth = hostView.visualViewport?.width || hostView.innerWidth;
  const viewportHeight = hostView.visualViewport?.height || hostView.innerHeight;

  const isMobile = viewportWidth <= 820;
  const isShortViewport = viewportHeight <= 560;
  const popupTop = isMobile
    ? (isShortViewport ? 68 : 124)
    : hostView.innerWidth <= 1180 ? 140 : 84;

  const desktopWidth = Math.max(
    270,
    Math.min(Number(requestedWidth) || 360, 420),
  );
  const popupWidth = isMobile
    ? Math.max(240, viewportWidth - 20)
    : Math.max(240, Math.min(desktopWidth, viewportWidth - 24));
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

  // Images change the content height after the modal is initially inserted.
  for (const image of info.querySelectorAll?.('img') || []) {
    if (!image.complete) image.addEventListener('load', syncHeight, { once: true });
  }

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

export const installCommunityModalPresentation = ({
  svgMap = window.svgMap,
} = {}) => {
  if (!svgMap?.showModal) return false;
  if (svgMap[INSTALL_KEY]) return true;

  const originalShowModal = svgMap.showModal;

  svgMap.showModal = function svg3PresentedShowModal(src, width, height) {
    const context = propertyContext();

    // Ordinary controller/tool modals remain untouched. Only a modal emitted
    // while a registered setShowPoiProperty callback is running is adapted.
    if (!context || isAlreadySvg3PropertyMarkup(src)) {
      return originalShowModal.call(this, src, width, height);
    }

    const title = layerTitle(svgMap, context.layerId);
    const normalizedSrc = normalizeNativePropertyMarkup(src);
    const wrapped = wrapNativePropertyMarkup(normalizedSrc, title);
    const info = originalShowModal.call(this, wrapped, width, height);

    return decorateNativePropertyModal(info, {
      requestedWidth: width,
    });
  };

  Object.defineProperty(svgMap, INSTALL_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
};
