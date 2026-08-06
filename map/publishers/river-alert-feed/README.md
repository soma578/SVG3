# River Alert Feed Publisher

許諾された河川情報配信をSVG3の共通河川水位featureへ変換するpublisher。
一般向けWebページのスクレイピングは行わない。

## 入力

`input.schema.json`に従うJSONをadapterから受け取る。

```text
authorized delivery
  -> provider-specific adapter
  -> input.schema.json
  -> riverAlertPipeline
  -> managed/river-level/data.csv
  -> QTCT/search/health
  -> static release
```

adapterは配信事業者固有の電文、認証、FTP、API等だけを担当する。
危険度判定とSVGMap向けデータ生成はこのpublisherが担当する。

受信処理と変換処理は分離する。adapter自身はネットワークへ接続せず、
契約済み受信daemonが原子的に配置したローカルファイルだけを読む。

## Provider adapter

adapterは次の構成で追加する。

```text
adapters/<provider-id>/
  adapter.config.json
  adapter.mjs
```

`adapter.mjs`は`adaptRiverAlertInput(context)`をexportし、
`input.schema.json`形式のオブジェクトを返す。ネットワーク接続、QTCT生成、
公開先への書き込みは行わない。

reference adapterは正規化済みJSONをそのまま受け取る。

```bash
npm run river-alerts:run-provider -- \
  --adapter normalized-json \
  --input /var/lib/svg3/incoming/river-feed.json \
  --output /var/lib/svg3/releases/river-alerts
```

runnerは単一実行ロックを取得し、入力のサイズとmtimeが安定してから読み込む。
変換後は共通publisher、QTCT生成、検査、release作成を実行する。
受信daemonは一時ファイルへ保存後、同一filesystem上でrenameして
`--input`のパスへ配置する。

## 検査

```bash
cd frontend
npm run river-alerts:publish -- --fixture --dry-run --now 2026-07-23T00:00:00Z
npm run river-alerts:check
```

fixtureは検査専用で、明示的な`--allow-fixture`なしでは適用できない。

## 配布物生成

```bash
npm run river-alerts:release -- \
  --input /var/lib/svg3/incoming/river-feed.json \
  --source-id contracted-provider \
  --output /var/lib/svg3/releases/river-alerts
```

入力検証、CSV適用、QTCT・検索索引生成、health検査、release作成を行う。
途中で失敗した場合は、ソース、QTCT、検索索引、build manifestを適用前へ戻す。

外部スケジューラは、契約した配信間隔に合わせてこのコマンドを実行する。
生成先の`release.json`を最後に公開し、JSONには120秒のcacheと
`stale-while-revalidate=600`を設定する。ブラウザは公式配信元へ接続せず、
静的ホストまたはCDNだけを読む。

releaseから本番公開先への切替はprovider adapterへ入れない。
オブジェクトストレージ、CDN、ローカル静的ホストごとのdeploy adapterが、
全データを配置した後にalert summaryと`release.json`を最後に切り替える。

## ローカル静的ホストへのdeploy

deploy先は次のSPIで追加する。

```text
deployers/<deployer-id>/
  deployer.config.json
  deployer.mjs
```

`deployer.config.json`はAPI version、network利用、必須option、必須環境変数、
capabilityを宣言する。moduleは`deployRiverAlertRelease(context)`をexportする。
共通runnerがreleaseを検証してからdeployerを呼び出す。

```bash
npm run river-alerts:deploy -- \
  --deployer local-static \
  --release /var/lib/svg3/releases/river-alerts \
  --target /srv/svg3/public
```

networkを利用するdeployerはmanifestの`networkAccess: true`に加え、
実行時の`--allow-network`が必要になる。資格情報は
`requiredEnvironment`で名前だけを宣言し、設定値をrepositoryやreleaseへ含めない。

初回だけ配信rootを明示的に初期化する。

```bash
npm run river-alerts:deploy:local -- \
  --release /var/lib/svg3/releases/river-alerts \
  --target /srv/svg3/public \
  --initialize-target
```

以後は`--initialize-target`を外す。adapterは次を検査・実行する。

- 配信rootの`.svg3-static-root.json` marker
- releaseの種別、公開状態、観測時刻、件数、全ファイルSHA-256
- 許可された`riverLevel`配下以外へのpath traversal
- 配信済みsnapshotより古いreleaseと、同時刻で内容が異なるrelease
- 単一実行lock
- データファイル、alert summary、配信manifestの順によるファイル単位の原子的置換
- 途中失敗時の変更ファイル復元

事前検査だけを行う場合は`--dry-run`を付ける。

```bash
npm run river-alerts:deploy:local -- \
  --release /var/lib/svg3/releases/river-alerts \
  --target /srv/svg3/public \
  --dry-run
```

CDNやobject storageではこのCLIを直接流用せず、同じrelease検証契約を使う
配信先専用adapterを実装する。資格情報とネットワーク処理をprovider adapterや
SVGMap runtimeへ入れない。
