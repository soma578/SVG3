# Layer Data Source Contract

SVGMap layer runtimeとデータの取得・管理は別の責務とする。

```text
upstream authority
  -> scheduled adapter / supplied snapshot
  -> local QTCT or JSON snapshot
  -> portable SVGMap layer
```

portable layerは、データがCSV、API、DBのどれから生成されたかを知らない。
map hostも外部取得URLやレイヤー固有の更新処理を持たない。

## Ownership

- `self`: 自分たちが正本データを管理する。publisherを持てる。
- `external`: 外部機関が正本を管理する。こちらは取得・キャッシュのみ行う。
- `sample`: 表示検証用の静的データ。実時間情報として扱わない。

`external`に自ポータルのpublisherを接続してはならない。

## Delivery

- `static-snapshot`: 手動または別系統から受け取った固定データ。
- `scheduled-snapshot`: 単一の運用ジョブが上流を取得し、前回正常値を更新する。
- `user-action-direct`: 詳細表示など明示的操作時だけ、公式サイトと同程度の取得を行う。

snapshotはブラウザごとに上流へ取得しない。
`runtimeFetch` は `false` とし、ホストは配信済みデータだけを読む。

## Scheduled refresh

scheduled adapterは必ず以下を宣言する。

- 最小実行間隔
- リクエスト開始間隔
- タイムアウト
- 最大同時数
- 前回データに対する最低取得率
- 前回正常値の保持

取得失敗や大幅な件数減少で空データを公開せず、旧スナップショットを保持する。
health manifestには最終試行、最終成功、スナップショット更新、
鮮度期限 `staleAfterAt`、件数、次回実行目安、最後の失敗理由を記録する。
利用側は保存されたstatusだけでなく、現在時刻と `staleAfterAt` を比較する。

## Current layers

- チーム活動: `self`。CSV publisherが正本管理を担当する。
- 全国河川監視カメラ: `external` + `scheduled-snapshot`。画像は利用者操作時のみ直接取得する。
- 河川水位・道路通行情報: 現在は `sample`。公式実時間データではない。
