# Evacuation Portable Layer

SVGMap 標準の `<animation>` から直接読める避難所代表ピンレイヤー。

この entrypoint は portal 固有の React 詳細カードを使わず、クリック詳細を
SVGMap 標準の `svgMap.showModal(...)` で表示する。

例:

```xml
<animation
  xlink:href="/map/layers/portable/evacuation/evacuationLayer.svg#summary=/map/data/qtct/evacuation/summary.json&amp;data=/map/data/qtct/evacuation/okayama/detail.json&amp;layer=evacuation"
  title="避難所"
  class="poi clickable"
  visibility="hidden"
  opacity="1" />
```

この checkout ではデータを `/map/data/qtct/evacuation/` に置く。外部へ渡す場合は、
同じ QTCT JSON を相対パスで同梱するか、`summary` / `data` hash parameter を
配布先の URL に合わせて指定する。

必要な共有ファイル:

```text
../representative-pins/representativePinsCore.js
../representative-pins/pinLayerProfiles.js
../representative-pins/mapMessages.js
../representative-pins/runtimeCache.js
```
