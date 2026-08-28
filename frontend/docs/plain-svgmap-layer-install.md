# SVG3レイヤーを通常のSVGMapへ追加する

## 確認済みのSVGMap本体

このリポジトリには `map/vendor/svgmapjs/` としてSVGMap.jsが同梱されている。
上流は `https://github.com/svgmap/svgmapjs.git`、固定commitは
`bfba98638040bc290ba43f9167fd00939fd0eca6`。監査ではSVG3のnative-mapを使わず、
このSVGMap.jsだけを読み込む最小ホストで確認する。

```bash
cd frontend
npx playwright test --config playwright.plain-svgmap.config.mjs
```

テスト用ホストは `e2e/fixtures/plain-svgmap/index.html`、追加宣言は
`e2e/fixtures/plain-svgmap/Container.svg` にある。

## 手動で動かす

リポジトリの親ディレクトリをHTTP公開する。`file://` ではES module、fetch、
controllerが動かないため使用しない。

```bash
cd SVG3-variants/svgmap-app-layers-host
node frontend/scripts/static-test-server.mjs 4176 .
```

ブラウザーで次を開く。

```text
http://127.0.0.1:4176/frontend/e2e/fixtures/plain-svgmap/index.html
```

最小ホストの要点は次の2つだけである。

```html
<div id="mapcanvas" data-src="./Container.svg"></div>
<script type="module">
const { svgMap } = await import('/map/vendor/svgmapjs/SVGMapLv0.1_r18module.js');
window.svgMap = svgMap;
svgMap.initLoad();
</script>
```

組み込み先のContainerへ、追加したいレイヤーの `animation` を置く。

```xml
<animation
  id="layer-flood-warning"
  xlink:href="/map/layers/portable/flood-warning/floodWarningLayer.svg"
  title="洪水・気象警報"
  class="poi clickable"
  visibility="visible"
  x="-30000" y="-30000" width="60000" height="60000" />
```

`animation` のbboxは子レイヤーではなく、追加先Containerの座標系で解釈される。
上流 `svgMapDemo/ContainerDemo0.svg` は経緯度等倍、SVG3の地域Containerは100倍座標
なので、同じ地域bboxを両方へコピーしてはいけない。通常のコミュニティContainerへ
持ち込む宣言では、上流レイヤー群と同じ全域bboxを使い、子SVG内部のタイリングとLODへ
空間ロードを任せる。

## 配置時に必要なもの

- `map/layers/portable/<package>/`: レイヤー本体。
- `layer.package.json` の `runtimeDependencies`: 共通controller runtime。
- `map/vendor/svgmapjs/`: SVGMap.js。組み込み先が同等runtimeを持つなら置換可能。
- `map/data/`、`data/`: snapshot・QTCT・地区境界を使うレイヤーのデータ。
- `map/icons/`: packageが参照するアイコン。

相対構造を維持するのが最も簡単である。別の構造へ置く場合は、Containerの
`xlink:href` とhash parameter内の `summary`、`data`、
`districtSvgUrlTemplate` を配置先へ合わせる。

気象警報レイヤーは気象庁の現行
`https://www.jma.go.jp/bosai/warning/data/r8/map.json` を直接取得する。
許可origin、5分間隔、同時1要求、cache、retryはレイヤー同梱のNetwork Contractが
強制する。気象庁への接続がない場合は端末内の直近cacheへ縮退する。

## 実ブラウザ監査結果

次の13レイヤーは、最小SVGMapホストで文書登録まで成功した。

- 行政界
- オフライン背景（全国・県）
- 避難所
- チーム活動（ピン・エリア）
- 洪水・気象警報
- 河川水位
- 全国河川監視カメラ
- 道路通行情報
- ハザード
- 現在地
- 配布レイヤーサンプル

controllerを持つ10件はcontroller起動を確認した。行政界・背景・ハザード・
チーム活動エリアはSVG要素の実生成、気象警報は警報ピン生成まで確認している。
避難所などのQTCTレイヤーはdata-readyとSVG生成を確認している。

これは「既存ファイルがある」という静的検査ではなく、Chromium上でSVGMap.jsへ
順番に追加した実行結果である。

## 公式cloneでの確認

最小ホストとは別に、次の上流リポジトリを実際にcloneして確認した。

- `svgmap/svgMapDemo` commit `c98c09e22db74ffa3f4eb133c637db3ca192a17a`
- `svgmap/svgmapAppLayers` commit `e1735dbc9c898a3f3eee4a554f95799d1c49bbc3`

`svgMapDemo/index.html`、公式レイヤー一覧UI、上流レイヤー資産は変更していない。
通常の導入操作として `ContainerDemo0.svg` に公開対象のSVG3レイヤー6件の
`animation` 宣言だけを追加した。対象は避難所、チーム活動ピン、チーム活動エリア、
洪水・気象警報、全国河川監視カメラ、ハザードである。行政界、オフライン背景、
河川水位、道路通行情報、現在地、配布レイヤーサンプルは追加対象に含めない。
公式の既存レイヤー176件とSVG3レイヤー6件、計182件が同じレイヤー一覧へ登録された。

公開対象を絞る前のChromium監査では、自作13件すべてのSVG document登録、
controller対象10件すべての起動、SVG要素生成を確認した。気象警報は現行JMA r8
実配信から9地点を描画し、監査中のpage errorは0件だった。公式画面へ常設する対象は
上記6件に限定する。
