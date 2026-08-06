/**
 * レイヤーメッセージバス契約
 * ============================
 * 配送モデル: hostはcatalogで宣言されたfromHost/toHost capabilityを照合し、
 * 対象レイヤーのcontroller windowだけへ配送する。
 *
 * 命名規約:
 *   runtime:*  レイヤー → ホスト/React 方向の通知
 *   map:*      ホスト → レイヤー方向の指示
 *   <layer>:*  特定レイヤー固有のライフサイクル通知
 *
 * デバッグ: 地図URLに ?debugBus=1 (または localStorage.svgmapDebugBus=1) で
 * current-map が全配送を console に出す。
 *
 * 新メッセージ追加時はここに定数を足すこと (文字列リテラル直書き禁止)。
 */
export const MAP_MESSAGES = Object.freeze({
  runtimeReady: 'runtime:ready',
  runtimeDataStatus: 'runtime:dataStatus',
  runtimeFeatureDetail: 'runtime:featureDetail',
  runtimeFeatureSelect: 'runtime:featureSelect',
  runtimePoiLayerRendered: 'runtime:poiLayerRendered',
  runtimeLayerReady: 'runtime:layerReady',
  runtimeViewportChanged: 'runtime:viewportChanged',
  runtimeLayerStateChanged: 'runtime:layerStateChanged',
  runtimeStartupMetrics: 'runtime:startupMetrics',

  mapSetViewport: 'map:setViewport',
  mapZoom: 'map:zoom',
  mapResetView: 'map:resetView',
  mapSetCurrentLocation: 'map:setCurrentLocation',
  mapFocusLocation: 'map:focusLocation',
  mapSetLayerVisible: 'map:setLayerVisible',
  mapSetLayerState: 'map:setLayerState',
  mapOpenLayerUi: 'map:openLayerUi',
  mapSetUiInsets: 'map:setUiInsets',
  mapImportLayers: 'map:importLayers',
  mapRemoveLayer: 'map:removeLayer',
  runtimeSetLayerVisibility: 'runtime:setLayerVisibility',
  mapLayerVisibilityChanged: 'map:layerVisibilityChanged',
  mapSetInteractionMode: 'map:setInteractionMode',
  mapInteractionModeChanged: 'map:interactionModeChanged',
  mapSetDataUrl: 'map:setDataUrl',
  mapSetLayerConfig: 'map:setLayerConfig',
  mapSetMunicipalityFilter: 'map:setMunicipalityFilter',
  mapShowEvacuationFeature: 'map:showEvacuationFeature',
  mapShowTeamActivityFeature: 'map:showTeamActivityFeature',

  teamActivityLayerReady: 'teamActivityLayer:ready',
});
