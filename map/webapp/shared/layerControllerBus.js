import {
  catalogLayerForKey,
  layerAllowsMessage,
  messageClaimMatchesLayer,
} from './layerMessagePolicy.js';

export const createLayerControllerBus = ({
  getCatalog,
  getSvgImageProps,
  getRootDocument,
  debug = false,
}) => {
  const bindings = () => {
    const catalog = getCatalog();
    const props = getSvgImageProps() || {};
    const rootDocument = getRootDocument();
    const result = [];
    const seen = new Set();
    for (const [iid, property] of Object.entries(props)) {
      const controllerWindow = property?.controllerWindow;
      if (!controllerWindow || seen.has(controllerWindow)) continue;
      const escapedIid = globalThis.CSS?.escape ? CSS.escape(iid) : String(iid).replaceAll('"', '\\"');
      const animation = rootDocument?.querySelector?.(`[iid="${escapedIid}"],[about="${escapedIid}"]`);
      const layer = [
        property?.rootLayer,
        property?.id,
        animation?.getAttribute?.('id'),
      ].map((key) => catalogLayerForKey(catalog, key)).find(Boolean);
      if (!layer) continue;
      seen.add(controllerWindow);
      result.push({ controllerWindow, layer });
    }
    return result;
  };

  const bindingForSource = (source) => (
    bindings().find(({ controllerWindow }) => controllerWindow === source) || null
  );

  const allowsFromLayer = (source, message) => {
    const binding = bindingForSource(source);
    return Boolean(
      binding
      && layerAllowsMessage(binding.layer, 'toHost', message?.type)
      && messageClaimMatchesLayer(binding.layer, message),
    );
  };

  const send = (message, debugLabel = '', targetKeys = []) => {
    const requestedLayers = targetKeys
      .map((key) => catalogLayerForKey(getCatalog(), key))
      .filter(Boolean);
    const targetIds = new Set(requestedLayers.map((layer) => layer.id));
    let delivered = 0;
    for (const { controllerWindow, layer } of bindings()) {
      if (targetIds.size > 0 && !targetIds.has(layer.id)) continue;
      if (!layerAllowsMessage(layer, 'fromHost', message?.type)) continue;
      try {
        controllerWindow.postMessage?.(message, '*');
        delivered += 1;
      } catch {}
    }
    if (debug) {
      console.log('[bus]', message?.type, debugLabel ? `(${debugLabel})` : '', `→ ${delivered} windows`);
    }
    return delivered;
  };

  return { allowsFromLayer, bindingForSource, bindings, send };
};
