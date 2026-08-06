# SVGMap layers

このディレクトリのレイヤー宣言から、47都道府県の `Container.svg` と
UI用の `catalog.json` を生成する。

基本方針:

- `Container.svg` / `<animation>` がSVGMap本家互換の成果物
- `portable/*/layer.package.json` は実行入口、依存、互換性、配布情報の正本
- `managed/*/layer.config.json` はmount、データ注入、UI catalog、build設定だけを持つ補助DSL
- `dropins/` は置くだけの実験用レイヤー
- `external/` は外部Container由来のレイヤー取り込み
- hostはレイヤー内部を知らず、catalogの `toggleKey` / `mounts` を見る

## Managed layer

最小構成:

```json
{
  "id": "layer-river-level",
  "title": "河川水位",
  "href": "/map/layers/portable/river-level/riverLevelLayer.svg#summary=/map/data/qtct/riverLevel/summary.json&data=/map/data/qtct/riverLevel/{regionId}/detail.json&layer=riverLevel",
  "class": "poi clickable",
  "visibility": "hidden",
  "opacity": "1",
  "order": 65,
  "layerPackage": "/map/layers/portable/river-level/layer.package.json",
  "bundle": {
    "release": true
  }
}
```

`layerPackage` を持つmountの `href` は、packageが公開するentrypointを使う。
地域単位の配布ZIPを生成する代表mountだけ `bundle.release: true` を宣言する。
同じpackageを複数mountする場合も、ディレクトリ走査順ではなくこの宣言で配布対象を決める。

`href` では次のトークンを使える。

- `{regionId}`
- `{prefCode}`
- `{prefCodeNum}`

未知トークンは残す。例えばハザードの `{code}` はレイヤーcontrollerが後段で処理する。

## UI catalog

サイドバー、検索、プリセット、hostの表示切替は `catalog.json` を読む。
`catalog.json` は直接編集しない。各 `layer.config.json` の `ui` から生成する。

```json
{
  "ui": {
    "catalog": true,
    "group": "防災情報",
    "symbol": "道",
    "accent": "#9F3128",
    "icon": "",
    "kind": "poi",
    "note": "通行止め、冠水、道路規制を表示",
    "toggleKey": "layer-road-closure",
    "mounts": ["layer-road-closure"],
    "visibilityStrategy": "native"
  }
}
```

主な項目:

- `catalog`: `true` のレイヤーだけをサイドバーへ出す
- `group`: サイドバーのグループ名
- `symbol`: アイコンがない場合の1文字表示
- `icon`: サイドバー用アイコン
- `accent`: サイドバー表示色。`#RRGGBB`で宣言し、hostにレイヤーID別CSSを持たせない
- `controllerUi`: レイヤー固有UIを持つ宣言。hostは開く操作だけを提供し、内容には関与しない
- `kind`: `poi` / `vector` / `external`
- `toggleKey`: UI/hostへ送る公開切替キー
- `mounts`: 1つのUI項目で同時にON/OFFするanimation id群
- `visibilityStrategy`: `native` または `controller`

複合レイヤーは `mounts` を使う。例えばチーム活動はUI上は1項目だが、実体はピンと地区エリアの2つ。

```json
{
  "ui": {
    "catalog": true,
    "toggleKey": "teamActivity",
    "mounts": [
      "layer-team-activity-pins",
      "layer-team-activity"
    ]
  }
}
```

`visibilityStrategy: "controller"` は、SVGMapの通常表示切替でレイヤーを破棄したくない場合に使う。
現在はハザードがこれに該当する。

## CSV publisher

チーム活動CSVは、ReactやAPIに依存しない静的publisherで管理する。

```text
/map/publishers/team-activity-csv/admin.html
```

publisherはCSVを検証し、入力CSV・公開状態・地域別QTCTを書き出す。
File System Access APIが使えない環境ではZIPを生成し、`publisher:import` で適用する。
新しい汎用CSVレイヤーは `managed/<slug>/layer.config.json` に `build.kind: "csv-qtct"`
を宣言し、portable `representative-pins` runtimeを利用する。

生成後に実行する基本手順:

```bash
npm run layers:check
npm run layers:build
npm run containers:generate
npm run assets:prepare
npm run containers:check
```

レイヤー単位で生成する場合:

```bash
npm run layers:build -- --layer roadClosure
npm run layers:build -- --layer layer-road-closure
npm run layers:build -- --layer road-closure
```

`--layer` は managed ディレクトリ名、`layer.config.json` の `id`、
または `build.qtctLayer` / `data.qtctLayer` で指定できる。
生成履歴は `/map/data/layer-build-manifest.json` に出る。

部分同期する場合:

```bash
npm run assets:prepare -- --layer roadClosure
npm run assets:prepare -- --path data/search/roadClosure/okayama.json
npm run assets:prepare -- --path layers/catalog.json
```

`--layer` は manifest の出力一覧から `map/...` の成果物だけを
`frontend/public/map/...` へコピーする。
`--path` は `map/` からの相対パス、または `map/...` 形式で指定できる。

## Search

`build.qtctLayer` または `data.qtctLayer` を持つ `kind: "poi"` レイヤーは、
自動で検索対象になる。

生成される検索定義:

```json
{
  "search": {
    "kind": "qtct",
    "layerId": "roadClosure",
    "url": "/map/data/search/roadClosure/{regionId}.json"
  }
}
```

検索対象にしたくない場合や特殊なURLを使う場合は、`ui.search` を明示する。

## Presets

レイヤーの組み合わせは `presets.config.json` に書く。

```json
{
  "presets": [
    {
      "id": "river-check",
      "label": "河川確認",
      "description": "水位・カメラ・ハザード",
      "layers": [
        "layer-river-level",
        "layer-japan-river-webcams",
        "layer-hazard"
      ]
    }
  ]
}
```

`layers` はcatalogに出ているレイヤーIDだけを参照する。

## Shareable map state

`native-map.html` はSVGMap本家に合わせ、表示状態をURL fragmentへ保存する。

```text
#xywh=global:<west>,<south>,<width>,<height>
 &visibleLayer=<layer-id>,<layer-id>
 &layer.<layer-id>=<opaque-controller-state>
```

- `xywh`: 表示範囲
- `visibleLayer`: 表示中のcatalog layer ID
- `layer.<layer-id>`: controllerが所有する不透明な状態文字列

hostはcontroller stateの内容を解釈しない。controllerは
`runtime:layerStateChanged`で保存を依頼し、`map:setLayerState`で復元値を受け取る。

## Build and check

```bash
npm run layers:build
npm run containers:generate
node scripts/prepare-public-assets.mjs
npm run containers:check
```

`containers:check` は次を検証する。

- 47コンテナに全レイヤーが1回ずつ存在する
- 参照ファイルが存在する
- catalogの `mounts` が実在する
- catalogの `presets` が実在catalogレイヤーだけを参照する
- catalogの `search` URLが存在する
- `visibilityStrategy` が既知値である

## External source update policy

閲覧者のブラウザから参照元サイトへ直接アクセスさせない。
外部データは管理側の単一ジョブで取得し、`/map/data` や `/map/media-cache` に
静的配布物として出す。

特に画像やライブ情報は閲覧者数に比例してアクセスが増えやすい。
Webカメラは次の契約を必須にする。

```json
{
  "build": {
    "kind": "webcam-qtct",
    "updatePolicy": {
      "clientExternalFetch": false,
      "cacheCommand": "npm run webcams:cache",
      "minIntervalMinutes": 10,
      "concurrency": 1
    }
  }
}
```

`webcams:cache` は参照元へ1本ずつ、間隔を空けて取得し、
`/map/media-cache/webcams/...` に保存する。
レイヤー詳細ではキャッシュ画像だけを表示する。キャッシュが無い場合は画像を出さず、
公式ページリンクだけを表示する。

限定運用時の結果は `map/media-cache/webcams/manifest.json` で確認する。
通常runtimeはユーザー操作時に公式画像を直接取得し、全件キャッシュを前提にしない。
