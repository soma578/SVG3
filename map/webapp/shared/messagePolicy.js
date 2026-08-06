import { MAP_MESSAGES } from './mapMessages.js';

export const PARENT_ONLY_MESSAGES = new Set([
  MAP_MESSAGES.mapSetViewport,
  MAP_MESSAGES.mapZoom,
  MAP_MESSAGES.mapResetView,
  MAP_MESSAGES.mapSetCurrentLocation,
  MAP_MESSAGES.mapFocusLocation,
  MAP_MESSAGES.mapSetLayerVisible,
  MAP_MESSAGES.mapSetLayerState,
  MAP_MESSAGES.mapOpenLayerUi,
  MAP_MESSAGES.mapSetUiInsets,
  MAP_MESSAGES.runtimeSetLayerVisibility,
  MAP_MESSAGES.mapImportLayers,
  MAP_MESSAGES.mapRemoveLayer,
  MAP_MESSAGES.mapSetInteractionMode,
]);

export const isAuthorizedHostCommand = ({
  type,
  source,
  parentWindow,
  origin,
  selfOrigin,
  layerMessageAllowed = false,
}) => {
  if (source === parentWindow && origin === selfOrigin) return true;
  if (PARENT_ONLY_MESSAGES.has(type)) return false;
  return layerMessageAllowed === true;
};
