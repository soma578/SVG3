# External SVGMap layers

## Browser preview

`/map/webapp/native-map.html` のレイヤーパネルから、次をインポートできる。

- SVGMap `Container.svg` URL
- 単体 SVG / HTML レイヤー URL

同梱済みの本家 `svgmapAppLayers` は、レイヤーパネルの「SVGMapコミュニティ」から
名前・通信先で検索し、レイヤー単位で追加できる。これは本家のディレクトリ構造と
相対参照を維持したまま `/map/svgMapAppLayers/Container.svg` を資産カタログとして使う。
追加結果はブラウザに保存され、地域を切り替えても再適用される。

Container 内の相対 `xlink:href` は Container URL を基準に解決される。
インポート定義はブラウザの `localStorage` に保存され、地図や地域を切り替えても
再適用される。Container のレイヤーは初期状態を非表示とし、単体レイヤーは表示する。

これは利用者単位のプレビュー機能であり、47地域の生成済み Container は変更しない。
外部サーバーから Container を取得する場合、配信元の CORS 設定が必要。

## Published import

全利用者へ公開するレイヤーは、次のパッケージを配置する。

```text
map/layers/external/<package>/
  Container.svg
  import.config.json
  layer.svg
  controller.html
  data/
  icons/
```

その後 `npm run map:build` を実行する。`scanExternalContainers.mjs` が animation を
抽出し、相対 href を `publicBase` へ rebaseして47地域のContainerへ合成する。

最小の `import.config.json`:

```json
{
  "id": "example-community",
  "container": "Container.svg",
  "publicBase": "/map/layers/external/example-community",
  "defaultVisibility": "hidden",
  "trusted": false,
  "include": ["*"],
  "exclude": []
}
```

この方式では、ディレクトリを置いて `npm run containers:generate` と
`npm run assets:prepare` を実行するだけで全47地域へ追加される。単体SVG/HTMLだけなら
`map/layers/dropins/` 直下へ置く方法も使える。

## Safety contract

外部Container由来のレイヤーは既定で隔離扱いにする。

```json
{
  "publicBase": "/map/layers/external/example",
  "trusted": false
}
```

生成時の扱い:

- `data-lawa-mode="isolated"` を付与する
- `trusted: true` の import だけ `data-lawa-mode="tight"` にできる
- `data-controller-src` / `data-script` は除去する
- 相対 `data-controller` は `publicBase` 基準へ rebase する
- `data-external-source` を付与し、Container上で外部由来と分かるようにする

例外として、管理者が配布物へ同梱した `/map/svgMapAppLayers/Container.svg` のGUIカタログは
`data-external-source="bundled-community"` として本家互換の `tight` 実行を許可する。
この例外は固定の同一オリジンURLだけに限定し、利用者が入力したURLや署名だけを確認した
外部配布物には適用しない。

外部レイヤーを「本番のポータル機能」として使う場合は、素のexternal importではなく、
managed layerとして責任を持つwrapperまたはportable entrypointへ昇格する。
