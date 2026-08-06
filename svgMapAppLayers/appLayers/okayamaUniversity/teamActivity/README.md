# Team Activity Portable Layer

CSV を正本として生成した静的 QTCT を表示し、コントローラーからローカルCSVも
追加できる、Next.js / Supabase 非依存の SVGMap portable layer。

利用者向けの「CSVを追加」はレイヤー本体に含まれる。既存データを置換せず、
追加QTCTとして合成するため、低ズームの密度表示と高ズームの個別ピンを共有する。
運用者が正本CSVを更新して静的成果物を公開する画面は次に分離している。

```text
map/publishers/team-activity-csv/admin.html
```

CSV:

```text
map/layers/managed/team-activity-pins/data.csv
```

生成:

```bash
npm run map:build
```

QTCT生成、47地域Container、public同期、参照検査まで一括実行される。
代表ピンのサイズは固定。画面内の件数がズーム別閾値を超えるたびに1本増え、
QTCT内の件数比に応じて高密度地域へ配分される。

クリーンな `svgmapAppLayers` へ一式を配置し `Container.svg` へ登録する例:

```bash
node scripts/install-team-activity-applayer.mjs /path/to/svgmapAppLayers
```

これはローカルディレクトリだけを書き換え、上流リポジトリへの通信は行わない。

SVGMap からの利用例:

```xml
<animation
  xlink:href="/map/layers/portable/team-activity/teamActivityLayer.svg#summary=/map/data/qtct/teamActivity/summary.json&amp;data=/map/data/qtct/teamActivity/okayama/detail.json&amp;layer=teamActivity"
  title="チーム活動"
  class="poi clickable"
  visibility="hidden"
  opacity="1" />
```
