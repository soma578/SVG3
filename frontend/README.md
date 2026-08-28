# SVG3 shared adapter resource-base refactor

## 何を直すか

現在の shared-base adapter は、元の SVGMap App Layers の SVG を

```text
svgMapAppLayers/appLayers/mlitRoad/jpAll2023.svg
```

から

```text
map/layers/external/svgmap-app-layers/adapters/shared/
  applayers-mlitroad-jpall2023-66.svg
```

のように flat な別ディレクトリへ複製します。

SVG内に静的に書かれた `xlink:href` / `data-controller` は generator が絶対URLへ
rebaseするため動きます。

しかし upstream controller が実行時に

```js
img.setAttribute("xlink:href", `icons/${ik}`)
```

のような相対URLを `svgImage` に挿入すると、そのURLは adapter SVG のURLを基準に
解決されます。

その結果、

```text
/adapters/shared/icons/icon_cam.png
```

を要求して404になります。

## 新しい方式

shared adapter のURL自体に upstream のディレクトリ構造を保存します。

```text
adapters/shared/
└─ appLayers/
   └─ mlitRoad/
      ├─ jpall2023-66.svg
      ├─ jpall2023-67.svg
      └─ icons/
         ├─ icon_cam.png
         ├─ michinoeki.png
         └─ ...
```

さらに source SVG / controller HTML / local helper JS を走査し、
runtimeで参照される相対静的assetだけを自動的にmirrorします。

したがってMLIT専用処理ではありません。

```text
icons/${name}
./legend/${kind}.png
images/frame_${id}.webp
./data/sample.json
```

など、実在するvendored sidecarへの相対参照を一般的に扱います。

HTML/JS controller自体はmirrorしません。
既存のabsolute rebase / `/map/svgMapAppLayers/...` を利用します。

## 追加・変更されるファイル

新規:

```text
frontend/scripts/lib/communitySharedAdapterAssets.mjs
frontend/test/communitySharedAdapterAssets.test.mjs
```

変更:

```text
frontend/scripts/generate-svgmap-community-compatibility.mjs
frontend/scripts/check-svgmap-community-compatibility.mjs
```

generated outputs:

```text
map/layers/external/svgmap-app-layers/adapters/shared/**
map/layers/external/svgmap-app-layers/compatibility.json
```

## 適用方法

PowerShell:

```powershell
.\apply.ps1 -RepoRoot C:\path\to\SVG3
```

このスクリプトは既存generator/checkerを一度だけ `.bak` に退避してからpatchし、

```text
helper unit test
community-layers:catalog
community-layers:check
npm test
```

を実行します。

## 適用後の確認

ライブカメラを開いて、次が消えることを確認します。

```text
GET /map/layers/external/svgmap-app-layers/adapters/shared/icons/icon_cam.png 404
```

代わりに概ね次のようなURLになります。

```text
GET /map/layers/external/svgmap-app-layers/adapters/shared/appLayers/mlitRoad/icons/icon_cam.png 200
```

Network proxy側については既に修正した host-inherited community policyをそのまま使います。

## 設計上の境界

この変更は「本家資産のruntime相対参照を壊さず再配置する」ための互換処理です。

- 本家SVGMap community layer:
  - source directory identityを保存
  - runtime relative sidecarをmirror
  - upstreamのコード意味は変更しない

- SVG3 own portable layer:
  - `layer.package.json` のNetwork Contractで規制

この2つは別責務のままです。
