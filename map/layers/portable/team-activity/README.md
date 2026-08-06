# Team Activity Portable Layer

CSV を正本として生成した静的 QTCT を表示する、Next.js / Supabase 非依存の
SVGMap portable layer。

表示runtimeはCSV生成・公開操作を持たない。管理用の静的publisherは次に分離している。

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

SVGMap からの利用例:

```xml
<animation
  xlink:href="/map/layers/portable/team-activity/teamActivityLayer.svg#summary=/map/data/qtct/teamActivity/summary.json&amp;data=/map/data/qtct/teamActivity/okayama/detail.json&amp;layer=teamActivity"
  title="チーム活動"
  class="poi clickable"
  visibility="hidden"
  opacity="1" />
```
