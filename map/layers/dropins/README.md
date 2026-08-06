# dropins — 置くだけレイヤー

SVGMap公式レイヤーや第三者レイヤー (SVG / HTML) をこのディレクトリに置くと、
全47都道府県コンテナへ animation レイヤーとして自動登録される。

## ワークフロー

```
1. ファイルを置く        map/layers/dropins/foo.svg
2. コンテナ再生成        node frontend/scripts/generate-denshi-containers.mjs
3. public へ同期         node frontend/scripts/prepare-public-assets.mjs (frontend/ で実行)
4. 検証                  node frontend/scripts/check-containers.mjs
```

(2〜4 は `npm run dev` / `npm run build` の pre フックでも実行される)

## ルール (docs/SVGmap_official_skill_first.md)

- layer.json も data-controller も要求しない
- host はレイヤーの意味を解釈しない (表示・非表示・重ね合わせのみ)
- id は `layer-dropin-<ファイル名>`、title はファイル名になる
- `.svg` はそのまま animation に載る
- `.html` は `.generated/<ファイル名>.svg` のwrapperを自動生成し、
  そのwrapperの `data-controller` からHTMLを起動する
- 描画順は managed レイヤーの後 (最前面)、ファイル名順
- 自作レイヤーで固有UI・データ契約を持つものは dropins ではなく
  `map/layers/managed/<id>/layer.config.json` で宣言する
