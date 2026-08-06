# SVGMap App Layers中心版

この複製は、2026-08-06時点の作業ツリーから次を外したソース版です。

- GUIの`layer.package.json URL`追加
- 上流参照型sidecarローダー
- 下電バス専用sidecar
- それら専用のE2E・ユニットテスト

残している追加経路は次のとおりです。

- 同梱`svgMap App Layers`をGUIの「SVGMapコミュニティ」から追加
- `Container.svg` URLから追加
- 単体SVG/HTML URLまたはローカルファイルから追加
- `map/layers/external/<package>/import.config.json`のディレクトリ配置
- `map/layers/dropins/`への単体レイヤー配置

`map/data`、生成済みContainer、portable配布物、`frontend/public`、`.next`、
`node_modules`は容量の大きい生成物なので複製していません。元リポジトリと同様の
データ生成・依存導入を行ってからビルドしてください。
