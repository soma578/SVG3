# Team Activity CSV Publisher

チーム活動CSVを検証し、地域別QTCTと公開状態を書き出す静的管理ツール。
React、Next.js、Supabaseには依存しない。

```text
/map/publishers/team-activity-csv/admin.html
```

ブラウザでCSVを選択し、File System Access APIでリポジトリの `map/`
ディレクトリを指定する。入力CSV、公開フラグ、生成QTCTを書き出した後、
`npm run map:build` でContainerとpublic mirrorを確定する。

File System Access APIに対応しないブラウザでは「ZIPを保存」を使う。
ZIPにはmanifest、入力CSV、公開フラグ、summary、47地域detailの計51ファイルが入る。

ZIPは展開せず、frontendディレクトリからCLIで適用できる。

```bash
# 内容と生成結果の整合性だけを検査する
npm run publisher:import -- ~/Downloads/team-activity.zip --dry-run

# 検査後に入力CSV・公開状態・QTCTを適用し、map:buildを実行する
npm run publisher:import -- ~/Downloads/team-activity.zip
```

CLIはZIPのCRC、パス、publisher契約、CSVから再生成したQTCTとのバイト一致を書き込み前に検査する。
`map:build`が失敗した場合は適用前のファイルへ戻す。生成を後で行う場合だけ
`--no-build`を指定し、公開前に必ず `npm run map:build` を実行する。

CSV正規化とQTCT生成は `map/publishers/shared/csvQtctPipeline.mjs` を使う。
`map:build` も同じ変換器を呼ぶため、ブラウザ出力とCLI出力は同一になる。

表示runtimeは `map/layers/portable/team-activity/` にあり、publisherを参照しない。
