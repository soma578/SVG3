# Managed CSV Layers

CSV から代表ピン用 QTCT を生成する managed layer は、各レイヤーの
`layer.config.json` に `build.kind: "csv-qtct"` を宣言する。

例:

```json
{
  "id": "layer-sample-csv",
  "title": "CSV サンプル",
  "href": "/map/layers/portable/representative-pins/representativePinsPortable.svg#summary=/map/data/qtct/sampleCsv/summary.json&data=/map/data/qtct/sampleCsv/{regionId}/detail.json&layer=sampleCsv",
  "class": "poi clickable",
  "visibility": "hidden",
  "opacity": "1",
  "order": 120,
  "ui": {
    "catalog": true,
    "group": "CSV レイヤー",
    "symbol": "C",
    "kind": "poi",
    "note": "managed CSV から生成",
    "pinProfile": {
      "label": "CSV サンプル",
      "symbol": "C",
      "color": "#2563eb",
      "iconMode": "generated",
      "statusAliases": {
        "normal": ["normal", "active", "平常"],
        "warning": ["warning", "alert", "要確認"],
        "closed": ["closed", "inactive", "停止"],
        "unknown": ["unknown", "不明"]
      },
      "defaultStatus": "normal",
      "statusColors": {
        "normal": "#2563eb",
        "warning": "#d97706",
        "closed": "#64748b",
        "unknown": "#475569"
      },
      "placement": "point",
      "individualKind": "poi"
    }
  },
  "build": {
    "kind": "csv-qtct",
    "source": "data.csv",
    "qtctLayer": "sampleCsv",
    "idColumn": "id",
    "titleColumn": "name",
    "longitudeColumn": "lon",
    "latitudeColumn": "lat",
    "regionColumn": "regionId",
    "prefCodeColumn": "prefCode",
    "addressColumn": "address",
    "summaryColumn": "summary",
    "statusColumn": "status",
    "defaultStatus": "unknown",
    "propertyColumns": {
      "sourceUrl": { "column": "source_url", "type": "string" },
      "observedAt": { "column": "observed_at", "type": "string" },
      "score": { "column": "score", "type": "number" }
    }
  }
}
```

`regionColumn` または `prefCodeColumn` がある場合は該当地域の
`detail.json` にだけ入る。どちらも無い場合は、小規模な全国/共通 CSV として
全 47 地域の `detail.json` に同じレコードを書き出す。

一括生成:

```bash
npm run map:build
```

このコマンドで CSV/QTCT、47地域の Container、portable package、public
assets を生成・検査する。

代表ピンのサイズは固定。画面内の件数をズーム別閾値で割り、
閾値1単位につき代表ピンを1本表示する。各ピンはQTCTの件数比で配分されるため、
高密度地域ほど表示ピン数が増える。
CSV に密度用の列を追加する必要はない。

## UI / catalog

`ui.catalog: true` を付けると `map/layers/catalog.json` に出力され、
native UIのサイドバー、検索、プリセット、hostの表示切替対象になる。

CSV/QTCTのPOIレイヤーは `build.qtctLayer` から検索定義が自動生成される。

```json
{
  "search": {
    "kind": "qtct",
    "layerId": "sampleCsv",
    "url": "/map/data/qtct/sampleCsv/{regionId}/detail.json"
  }
}
```

複数animationを1つのUI項目で切り替える場合は `ui.mounts` を使う。

```json
{
  "ui": {
    "catalog": true,
    "toggleKey": "sampleComposite",
    "mounts": [
      "layer-sample-pins",
      "layer-sample-area"
    ]
  }
}
```

## Layer-specific properties

CSV固有の列はトップレベル項目を増やさず、`properties` に通す。
`propertyColumns` で列名と型を宣言する。

対応型:

- `string`
- `number`
- `boolean`
- `json`

空欄の `number` は `null` として扱う。
