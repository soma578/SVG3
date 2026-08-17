# SVGMap layer platform roadmap

このリストは都度見直す。目的は、SVGMap互換性を守りながら、
生成・検索・更新・配信を軽く、安全にすること。

## P0: 検索専用 `search.json`（完了）

現状の問題:

- native検索がQTCT `detail.json` を読む
- レイヤーが増えるほど検索のためだけに重いデータを読む
- 地図描画用データと検索用データが密結合

対策:

- `layers:build` で `/map/data/search/<qtctLayer>/{regionId}.json` を生成する
- 中身は `id/title/subtitle/searchText/lat/lon/symbol/targetLayerId` だけ
- `catalog.layers[].search.url` は search index を指す
- 地図描画は従来通りQTCTを読む

成功条件:

- native検索がQTCT detailを直接読まない
- `containers:check` が search URL の存在を検証する
- 検索対象追加は `layer.config.json` だけで済む

実装状態:

- `layers:build` が `/map/data/search/<qtctLayer>/{regionId}.json` を生成する
- catalogの自動検索URLは `/map/data/search/...` を指す
- native検索は search index を優先し、旧QTCT detail形式にもフォールバックできる

## P1: レイヤー単位ビルド（完了）

現状の問題:

- 1つのCSVを変えても全CSV/QTCTレイヤーを再生成する
- Webカメラなど重いレイヤーが増えるほど遅くなる

対策:

- `npm run layers:build -- --layer <qtctLayer|layer-id>` に対応する
- `build-manifest.json` に入力hashと出力一覧を保存する
- 変化したレイヤーだけ再生成できるようにする

成功条件:

- 生成ページで作った1レイヤーだけbuildできる
- 全buildと部分buildの出力が一致する

実装状態:

- `npm run layers:build -- --layer <qtctLayer|layer-id|managed-dir>` に対応
- `/map/data/layer-build-manifest.json` に入力hashと出力一覧を保存する
- full build は従来通り全build対象と全search indexを生成する

## P2: public assetsの対象同期（完了）

現状の問題:

- `prepare-public-assets` が `map` 全体同期に寄っている
- 画像キャッシュやQTCTが増えるほど重くなる

対策:

- `--layer <id>` / `--path <map-relative-path>` で対象同期
- 生成物だけをpublicへコピー
- Webカメラ画像キャッシュは差分同期

成功条件:

- 新規CSVレイヤー追加時に必要ファイルだけ同期できる
- 全同期と部分同期の結果が一致する

実装状態:

- `npm run assets:prepare -- --layer <qtctLayer|layer-id>` に対応
- `npm run assets:prepare -- --path <map-relative-path>` に対応
- `--layer` は `/map/data/layer-build-manifest.json` の `map/...` 出力だけを同期する
- 引数なしの全同期は従来通り維持する

## P3: generated layer style/profile（完了）

現状の問題:

- 生成レイヤーはgeneric profileで動くが、見た目の差が弱い
- `pinLayerProfiles.js` に固定追加しないと細かい表現が難しい

対策:

- `layer.config.json.ui.symbol/color/statusAliases` を代表ピンcoreへ渡す
- unknown/generic profileをconfigで拡張できるようにする

成功条件:

- 生成ページだけでアイコン色・状態ラベルを最低限設定できる
- portable性を壊さない

実装状態:

- managed `ui.pinProfile` をContainer生成時に `profile=` hash paramとして注入する
- representative pins core が profile override を読み、固定profileにマージする
- `symbol/color/statusColors` が指定された場合は動的SVGマーカーを生成する
- 生成ページは基本色を受け取り、生成configに `ui.pinProfile` を出力する

## P4: Webカメラ暫定運用（固定台帳・利用者操作時のみ）

- 台帳の定期取得は停止し、固定スナップショットとして扱う
- ブラウザ偽装ヘッダーを使わない
- 一覧表示、prefetch、自動更新では画像を取得しない
- 自サーバーへの画像保存・再配信機能を持たない
- 詳細を開いたときだけfeature flag確認後に公式画像を直接取得する
- 手動更新は30秒以上、取得失敗時は公式ページへ誘導する
- 出典、画像取得時刻、撮影時刻不明、第三者配信元からの取得を表示する

## P5: 外部レイヤー取り込みの安全化（完了）

現状の問題:

- 外部Container由来の `<animation>` 属性をほぼそのまま保持している
- `data-controller-src` のようなコード埋め込み属性が混入する余地がある
- 外部controllerが同一オリジン上のT-LaWAとして動くと、親host依存や権限過多になりやすい

対策:

- 外部importは既定で `data-lawa-mode="isolated"` を付与する
- 明示的に `trusted: true` のimportだけ `tight` にできる
- `data-controller-src` / `data-script` は除去する
- 相対 `data-controller` は `publicBase` 基準へrebaseする
- `check-containers` で外部animationの安全属性を検証する

成功条件:

- 外部レイヤーを取り込んでも危険なinline/controller-src属性が残らない
- 外部由来かどうかがContainer上で判別できる
- publicBaseが `/map/` 配下であることを検証できる

実装状態:

- `scanExternalContainers.mjs` が外部animation属性をsanitizeする
- 外部animationへ `data-lawa-mode` と `data-external-source` を付与する
- `check-containers` が外部animationの安全契約を検証する
- `check-layer-configs` が external `import.config.json` の基本契約を検証する

## P6: dropin HTML の自動wrapper SVG化（完了）

現状の問題:

- `.html` dropin を直接 `<animation xlink:href="...html">` に載せると、SVGMap本家の
  `data-controller` 起動形式から外れる
- HTMLレイヤーとSVGレイヤーの入口形式が揃わない

対策:

- `map/layers/dropins/foo.html` を検出したら `map/layers/dropins/.generated/foo.svg` を生成する
- Containerにはwrapper SVGを載せる
- wrapper SVGの `data-controller` から元HTMLを起動する
- `.svg` dropin は従来通りそのまま載せる

成功条件:

- HTMLを置くだけで、SVGMap標準のSVG entrypoint + controller形式になる
- hostはdropin HTMLの中身を知らない
- 既存SVG dropinの挙動は変えない

実装状態:

- `scanDropinLayers` がHTML dropin用wrapper SVGを自動生成する
- wrapperは `/map/layers/dropins/.generated/<name>.svg` に出る
- dropins READMEにルールを追記した

## 今後の正本

- 実行UIは `native-map.html` を正本とする
- `current-map.html` はSVGMap起動、汎用表示制御、汎用メッセージ中継だけを担当する
- React地図画面は移行対象に含めず、現状保存のみとする
- レイヤー追加、検索、プリセット、外部importは `catalog.json` を契約にする

## P7: runtime外部importの隔離（完了）

現状の問題:

- ビルド時external importは隔離されるが、地図上から追加するruntime importは契約が異なる
- runtime importが任意の `data-*` 属性を保持している
- isolated controllerからhost操作メッセージを送れる余地がある

対策:

- runtime importも危険なcontroller/script属性を除去する
- 外部レイヤーへ常に `data-lawa-mode="isolated"` を付ける
- `data-controller` と `xlink:href` を取得元URL基準で解決する
- host操作命令は同一originの親UIからだけ受理する
- runtime import契約の自動テストを追加する

成功条件:

- 外部Container由来の任意 `data-*` がhost権限を得ない
- isolated外部レイヤーからviewport、表示、import、削除を操作できない
- 通常のSVG/Container追加は引き続き動作する

実装状態:

- runtime importerを属性allowlistへ変更した
- runtime importへ `data-lawa-mode="isolated"` と由来属性を強制する
- 相対layer/controller URLを取得元Container基準へrebaseする
- viewport、zoom、表示、import、削除などのhost命令を同一originの親UIだけに制限する
- `npm run runtime-import:check` を追加し、`map:build` に組み込んだ

## P8: portable契約の明文化（完了）

- `workspace-portable` と `distribution-portable` を区別する
- packageへLaWA mode、SVGMap API能力、依存、データ注入方式を宣言する
- controller起動を `layerWebAppReady` 優先へ統一する
- package検査で絶対 `/map/` URLとpackage外依存を可視化する

実装状態:

- 全packageへ `portability.level`、データ注入方式、既知の制約を宣言した
- 全packageへ対応LaWA mode、ready event、必要SVGMap APIを宣言した
- 現在の6packageは実態に合わせて `workspace-portable / tight` とした
- `distribution-portable` はpackage外依存と絶対データURLを検査で禁止する
- portable検査がpackageごとの外部依存数と絶対URL数を表示する
- representative pinsとチーム活動地区layerを `layerWebAppReady` 対応にした
- portable検査がentrypointの依存グラフ上にready event実装があることを確認する

## P9: 動的POI更新のネイティブ化（実装完了・実機確認待ち）

- viewport再設定によるPOI再解析を撤去する
- 通常POI、SVGMap側の更新経路、必要時のlayer内hit testerを比較する
- 複数レイヤーが同時描画されても地図全体を再読み込みしない

実装状態:

- representative pinsの同一viewport再設定を遅延 `refreshScreen()` へ置換した
- hostのPOI更新通知もviewportを変更せず `refreshScreen()` だけを呼ぶ
- SVGMap本体の `dynamicLoad -> parseSVG -> setPoiBBox` 経路を自動検査する
- `npm run native-poi:check` を追加し、`map:build` に組み込んだ
- ピン表示、クリック、重複POI選択は実ブラウザで最終確認する
- 重複POI用のSVGMap標準tickerをhostで隠さず、候補ポップアップとして表示する

## P10: hostからレイヤー固有処理を除去（実装完了・実機確認待ち）

- ハザード固有ready/config/filter処理をlayer/config側へ移す
- hostのmessage handlerを汎用命令と汎用状態通知だけにする
- レイヤー名をhostへ追加せず新規レイヤーを運用できる状態にする

実装状態:

- hostのハザード固有config/ready/dataReady分岐を削除した
- ハザードURLとruntime keyはmanaged configのhash paramで自己宣言する
- レイヤーは汎用 `runtime:layerReady` を通知し、hostは現在の自治体・操作モード・表示状態を再送する
- hostの避難所fallback設定とレイヤー固有ログを削除した
- ハザードの同一viewport再設定を遅延 `refreshScreen()` へ置換した
- `npm run native-host:check` を追加し、hostへの固有契約再混入を検出する
- ハザードの初期表示、トグル、ズーム別県/市町村切替は実ブラウザで最終確認する

## P11: 全国データの軽量化（実装完了・実機計測待ち）

- summaryを描画に必要な最小フィールドへ縮小する
- 大きい全国summaryを空間単位で分割し、viewportに応じて取得する
- 非表示レイヤーのcontroller/dataを起動しない
- 転送量だけでなくJSON parse時間と描画時間も計測する

実装状態:

- summaryの代表点を描画に必要なID、名称、状態、座標、件数へ限定した
- representative pins起動時のsummary先読みを撤去し、最初の描画要求まで取得しない
- summary代表点の選択時は地域detailを読み、レイヤー固有属性を含めて補完する
- runtime cacheが転送byte数、読込時間、JSON parse時間を返す
- representative pinsが描画件数とDOM生成時間を計測する
- 全国カメラsummaryを1.5MB以下に保つ `npm run native-data:check` を追加した
- viewport単位のsummary分割と、SVGMapがhidden animationを描画対象にするかの実測は次段で行う

第2段階:

- `build.summaryShardDepth` で固定QTCT空間シャードを生成できる
- 全国カメラはdepth 2で分割し、`summary.json` を相対URLのシャード索引にした
- representative pinsはviewportと交差するシャードだけ取得し、読込済みtreeを合成する
- 取得失敗したシャードは30秒間再試行を抑制する
- 全国11,344件は1.1KiBの索引と5つの非空シャード（合計約1.33MiB）になった
- 岡山を含むシャードは約296KiBで、従来の全国一括summaryより約78%小さい
- シャードID、件数合計、個別/合計容量、詳細属性混入を自動検査する
- hidden animationが初回drawを呼ぶか、実際のNetwork/Performance値はブラウザで最終確認する

画像取得方針（全件キャッシュ方式から変更）:

- 地図表示時とsummary取得時には画像を取得しない
- 詳細を開いた1地点だけ、公式画像ホストから直接取得する
- 初回画像にcache bustを付けず、手動更新だけ10秒のクールダウンを適用する
- 自動更新、事前取得、任意画像ホストを禁止する
- 許可ホストは `cam.river.go.jp` と `www.river.go.jp` に固定する
- サーバー画像ストレージとNext.js画像APIをruntime要件にしない

## P12: 生成物を一方向パイプラインへ統一（完了）

- `map/` を生成正本、`frontend/public/map/` を配信コピーとする
- generatorによるmap/public二重書き込みを廃止する
- layer build manifestから対象同期する
- 47 Containerと大容量QTCTの不要なgit差分を減らす

実装状態:

- QTCT、検索index、build manifest、Container、catalogは `map/` だけへ生成する
- generatorから `frontend/public/map/` への直接書き込みを除去した
- `assets:prepare`だけが正本を公開側へ同期する
- 全同期は公開先を置換し、正本から削除された古いファイルを残さない
- 部分同期はbuild manifestの `map/...` 出力だけを対象にする
- 避難所の旧専用QTCT生成物もmanifestへ収集し、部分同期できる
- JSON、Container、catalogは内容が同じ場合にmtimeを変更しない
- manifestの生成時刻は入力hashが変わったレイヤーだけ更新する
- `assets:check` がmanifest生成物を含む正本/公開コピー530ファイルをSHA-256比較する
- `pipeline:check` がgeneratorへのpublic直接書き込み再混入を検出する
- `predev` は公開資産が存在すれば全地図buildを省略し、現在は約1秒で完了する

対象外:

- `/data/{regionId}/districts-svg/` は既存URL互換のため `frontend/public/data` に残る旧資産系統
- これは約767MBあり、P13以降で配布bundle・地域単位生成と合わせて移行判断する

## P13: 外部配布bundleと互換テスト

- portable package、共有core、必要データをbundle化する
- 素のSVGMap Containerから読み込むfixtureを用意する
- tight/isolated、クリック、詳細、表示切替を自動検証する
- package単体で別パス・別originへ配置できるか判定する

実装状態:

- `portable:bundle` が `layerPackage` と `bundle.release: true` を持つmanaged mountから地域単位bundleを生成する
- bundleは `Container.svg`、素のSVGMap `viewer.html`、portable runtime、共有core、
  対象地域QTCT、icons、SVGMap runtimeを含む
- bundle内だけで `/map/icons` とデータURLを相対化し、元packageは変更しない
- `portable:bundle:check` が全ファイルhash、Container参照、`/map` 絶対URLを検証する
- tight entrypointはT-LaWA APIを必要とするため、互換表は `tight=PASS` と明示する
- isolatedは本家S-LaWAと混同せず、宣言済みpostMessage adapterだけを
  `isolated=ADAPTER-SUPPORTED` として別枠で示す
- 既定bundleは地域detailと、そこから詳細属性を除いたregional summaryを別々に同梱する
- fixtureのチェックボックスで表示切替を確認でき、POIクリックと詳細は本家
  `setShowPoiProperty` / `showModal` 経路を使う

実装状態:

- `portable:bundle:e2e` が静的HTTP配信した5bundleをChromiumで開き、ネイティブPOI描画、
  表示切替、地理座標からの実クリック、詳細modal生成を検査する
- SVGMapのOFF/ON後にcontroller生成POIが再描画されることは独立した回帰項目として残す
- `isolated-runtime/protocol.js` は `render/select/detail/context` の構造化messageだけを許可する
- 別origin controllerがQTCTを読み、親のtrusted rendererが検証済みfeatureだけをSVGへ描画する
- detailは任意HTMLではなくlabel/value行として受け取り、親側でescapeして表示する
- Playwrightが4173/4174の別origin、sandbox DOM隔離、ネイティブクリック、偽装message拒否を検査する
- isolated protocol fixtureとpackage宣言の双方が揃った5packageだけを
  `isolated=ADAPTER-SUPPORTED` として扱う

## P14: 既存QTCT coreのisolated adapter化

- QTCT探索・密度判定をDOM描画から分離する
- tight adapterは現在の `svgImage` 直接描画を維持する
- isolated adapterは同じfeature列をprotocolの `render` へ送る
- viewport contextと再描画revisionを定義する
- 5packageを順にisolated fixtureへ載せ替え、対応済みpackageだけmanifestを昇格する

実装状態:

- QTCT探索、ズーム別深度、密度配分をDOM非依存の `qtctFeatureEngine.js` へ分離した
- tight coreは同じengineが返すfeature列を従来どおり `svgImage` の `<use>` へ描画する
- isolated controllerは別originでQTCTを読み、同じengineのfeature列だけをprotocolへ送る
- hostはviewportとSVGMap scale相当のzoom、単調増加revisionを送る
- `screenRefreshed` が親へ届かないruntimeにも対応するため、250msごとにviewport署名だけを比較する
- 古いrevisionのrenderは拒否し、同一viewportではmessageもデータ再取得も発生させない
- 河川水位でtight/isolatedのfeature ID・件数、ネイティブクリック、固有詳細行の一致を検証した
- portable packageが `isolated.detail.rows` で詳細項目、ラベル、単位を自己宣言できる
- 道路通行情報も同じ宣言方式でtight/isolatedのfeature列と詳細を検証した
- チーム活動はfeature直下の項目も `isolated.detail.rows[].field` で宣言できる
- チーム活動でtight/isolatedのfeature ID、SVG配置座標、クリック詳細を検証した
- 全国河川カメラはpackageで文字行、画像、公式リンク、許可ホストを自己宣言する
- media protocolはHTTPS画像2件・リンク4件を上限とし、hostがbuild時policyでホストを再検証する
- 全国河川カメラで詳細クリック前の画像取得が0件、クリック後は許可ホストだけに1地点分を要求することを検証した
- isolated側の手動画像更新も10秒以上のクールダウンを強制し、自動更新は行わない
- bundleは地域detailから詳細属性を除いた軽量regional summaryを別生成する
- isolated controllerは低ズームでsummaryだけを読み、代表点クリック時にdetailをIDで後読み補完する
- 避難所でクリック前のdetail取得0件、クリック後の取得、`enriched=true`、住所表示を検証した
- status overlayはポータル運用時の任意入力であり、静的portable bundleの成立条件から分離する
- summary保持深度をmanaged mountの `bundle.summaryMaxDepth` で自己宣言できる
- 避難所regional summaryを深度11で枝刈りし、約939KBから約670KBへ削減した
- 最大summaryズームでもtight/isolatedのID、SVG座標、statusアイコンが一致することを検証した
- 各packageが `isolated.render.icons` で同梱statusアイコンを相対パス宣言する
- trusted rendererはbuild時に `map/icons` 内と確認したアイコンだけを描画する
- package検査が詳細行の形式、1-24件制限、必須値、重複propertyを検出する
- cross-origin DOM遮断と、iframe以外から送られた偽装renderの拒否をPlaywrightで検証した
- 5packageが `isolated.layerEntrypoint`、`controllerEntrypoint`、`hostBridge`、
  `svgmap-isolated-layer@1` を自己宣言する
- generatorはisolated runtimeの固定パスと一括コピーを持たず、package宣言からHTMLの
  `script src` を含む依存グラフを収集する
- Container、viewer、manifestは同じpackage宣言から生成し、配布checkerが相互一致を検証する
- 互換表を5packageとも `isolated-package=ADAPTER-SUPPORTED` へ昇格した
- Playwrightはmanifestのcontroller宣言と別origin iframeの実URLも照合する

P14完了条件:

- 5packageすべてのisolated protocol adapterを `verified-adapter` にする
- tight/isolatedでfeature IDとSVG配置座標を一致させる
- 代表点詳細、画像遅延取得、偽装message拒否を自動検証する

次段の残作業:

- 配布bundleは巨大な地区境界資産を同梱しないため、teamActivityは元データ座標に配置する
- 地区重心配置も配布する場合は、地域別district subsetをbundleへ選択的に含める
- 同梱SVGMap runtimeが本家S-LaWA自動起動へ対応した場合は、現在のadapter契約とは別に
  native isolated entrypointを追加して互換性を検証する
- 共有generic adapterを将来差し替える場合も、package宣言とprotocol versionを通して移行する

## P15: 配置先非依存のデータ注入契約

- portable runtimeからサイト固有データURLを除去する
- packageが必要なfragment parameterを自己宣言する
- managed mountが必須parameterを渡していることを生成前に検証する
- 配布bundleへ地域データを書き足しても、元の注入契約を保持する

実装状態:

- 6packageが `data.injection.transport=svg-fragment-query` を宣言する
- `data` と `layer` を必須、`summary` 等を任意parameterとして宣言する
- package manifestから `/map/...` の既定データURLを除去した
- `layers:check` がmanagedのhref entrypoint一致と必須parameterを検証する
- `portable:check` がparameter名、重複、必須項目、transportを検証する
- bundle generatorは注入契約を保持したまま地域summary/detailの相対URLを追加する
- bundle checkerは注入契約と同梱データ参照を再検証する

次段の残作業:

- `../representative-pins` の共有core依存をversion付きruntime dependencyとして宣言する
- packageと依存packageをまとめた再配置可能なrelease layoutを定義する
- 旧 `okayama-webcams` packageは全国版への移行確認後に削除済み

## P16: version付きruntime dependencyと配布lock

- 共有coreを暗黙の `../` ファイル参照ではなくruntime packageとして宣言する
- レイヤーpackageがruntime ID、version、manifestを依存宣言する
- 未宣言のpackage外importと未exportファイル参照を生成前に拒否する
- 配布bundleへ解決済みdependency lockとintegrityを記録する

実装状態:

- `representative-pins@1.0.0` と旧 `isolated-runtime@1.0.0` の
  `runtime.package.json` を追加した（後者はP19でnative S-LaWAへ置換済み）
- 旧isolated runtimeはrepresentative runtimeへの推移依存を宣言していた
- 6レイヤーpackageの外部shared列挙を `runtimeDependencies` へ置き換えた
- package checkerがID/version/type、循環、exports、未宣言importを検証する
- bundle generatorがruntime manifestのexportsと推移依存を収集する
- bundle manifestと同梱layer packageへ解決済みlockを記録する
- integrityはURL相対化などの配布変換後ファイルからSHA-256で計算する
- bundle checkerが同梱runtimeからintegrityを再計算し、改変や欠落を検出する

次段の残作業:

- runtime package version更新規則と変更履歴を定義する
- bundle全体だけでなく、layer + runtime + dataを個別artifactとして公開するindexを作る
- 旧 `okayama-webcams` packageの参照監査と削除は完了

## P17: portable artifact indexと配信世代検査

- 配布可能なlayer/runtime/data bundleを機械的に列挙するindexを生成する
- indexとbundle manifestの欠落・余剰を双方向に検査する
- E2Eが古い `public/map` を誤って検証しないよう開始前に同期状態を確認する

実装状態:

- `map/distribution/portable/index.json` をbundle manifest群から自動生成する
- package、地域、tight/isolated入口、互換性、runtime lock、容量、manifest hashを収録する
- 部分bundle生成後も既存manifestを再走査してindex全体を更新する
- bundle checkerがindexとmanifestの件数・ID・地域・path・SHA-256を照合する
- indexに宣言された4種類のentrypointが実在することを検証する
- `portable:bundle:e2e` はPlaywright起動前に `assets:check` を必ず実行する
- Playwrightが配信されたartifact indexと6bundleの互換性宣言を検証する

次段の残作業:

- artifact indexをnative mapの追加UIから参照し、検証済みbundleを選択追加できるようにする
- release artifactの署名・配布元・ライセンス情報をpackage manifestへ追加する
- 旧 `okayama-webcams` packageの参照監査と削除は完了

## P18: native mapの検証済みartifact追加

- native mapの追加UIからartifact indexを参照する
- 現在地域で利用可能な検証済みbundleだけを選択可能にする
- 既存managed mountと同じartifactを二重追加しない
- 通常の外部URL・ローカルファイルは従来どおりisolatedを既定にする

実装状態:

- 追加形式に「検証済みレイヤー」を追加し、URL入力とは別の選択UIにした
- artifact indexのschema、path、tight互換性をクライアント側でも確認する
- bundle manifest/indexへ`layerId`と表示名を追加した
- 既存`layerId`がある場合は新規importせず、そのmountをONにする
- 未搭載artifactだけ同一originの検証済みContainerからtight importする
- 通常Container、SVG、HTML追加は引き続きisolatedとしてsanitizeする
- `release.kind=standalone-static` のportable packageを、managed mountなしでbundle化できる
- tight-only artifactを許容し、未対応のisolated入口をmanifest/indexへ明示する
- 追加したanimationをsessionへ保持し、既存Containerと合成したblob ContainerとしてSVGMapを再起動する
- 合成時にanimation hrefとデータ用hash parameterを絶対URLへrebaseする
- Playwrightが未搭載の配布サンプルを一覧から追加し、描画・POIクリック・native modalまで検証する
- portable packageを正本に、発行者・ライセンス・公開日時・versionをmanifest/indexへ伝播する
- 追加UIで選択中artifactの発行者・ライセンス・公開日・version・容量を表示する
- package、bundle、index、ブラウザE2Eで配布メタデータの欠落を検出する

次段の残作業:

## P19: 署名付き外部artifact index

- 外部indexはEd25519署名、有効期限、信頼済み公開鍵を必須にする
- 署名者のpublisher IDと全artifactのpublisher IDを一致させる
- index署名だけでなく、bundle manifestとContainerのSHA-256も照合する
- 外部artifactは署名済みでもtight実行せずisolated固定にする
- 秘密鍵をrepositoryへ置かずに署名できるCLIを提供する

実装状態:

- `artifactIndex.js` にcanonical JSON、Ed25519検証、path検証、manifest/Container hash検証を集約した
- `trusted-publishers.json` を管理者側の公開鍵trust storeとした
- `portable:index:sign` で有効期限付き外部indexを生成できる
- native mapに「署名済み配布一覧」を追加し、検証成功後だけartifactを選択できる
- native S-LaWA非対応artifactは外部一覧から除外する
- Playwrightで正規署名の受理、index改ざんの拒否、未署名一覧のUI拒否を検証する
- SVGMap.jsを公式`bfba986`へ更新し、S-LaWA client runtimeをportable dependencyとして同梱した
- `artifact-sample`をtight/isolated共通entrypointにし、cross-origin iframeでDOM同期する
- 初期SVG要素にも`data-slawa-id`を付け、`defs`配下の追加とPOI選択を同期対象にした
- 署名済み外部artifactの実行はnative S-LaWA対応packageだけに限定した
- Playwrightで別originのcontroller、POI描画、`setShowPoiProperty`、modal往復を検証する

次段の残作業:

- 本番配布者のEd25519公開鍵と正式ライセンスを登録する
- 失効鍵一覧と鍵ローテーション期間を運用手順へ追加する
- `riverLevel`をcustom adapterからnative S-LaWA共通runtimeへ移行し、tight/isolated共通entrypointにした
- `teamActivity`のピンentrypointをnative S-LaWA共通runtimeへ移行した
- `roadClosure`をnative S-LaWA共通runtimeへ移行し、distribution-portableにした
- `japan-river-webcams`をnative S-LaWAへ移行し、宣言型画像更新を追加した
- `evacuation`をnative S-LaWAへ移行し、全6artifactのcustom adapter撤去を完了した
- 旧 `okayama-webcams` packageを削除し、全国版へ一本化した
- 旧 `isolated-runtime` packageとgenerator/checkerのcustom adapter互換分岐を削除した
- managed portable bundleはnative S-LaWAを必須とし、成果物検査もadapter配布を拒否する
- SVGMap.js本家へ初期要素の`data-slawa-id`修正を還元できるか確認する

## P20: チーム活動runtimeとCSV publisherの分離

- portable packageは表示・QTCT読込・詳細表示だけを所有する
- CSV変換、公開切替、生成物書出しは独立した静的publisherが所有する
- publisherとmanaged mountの参照を機械検査する

実装状態:

- `admin.html` を `map/publishers/team-activity-csv/` へ移動した
- 公開フラグを `managed/team-activity-pins/publication.json` へ移動した
- `teamActivity` packageから`adminEntrypoint`を除き、`distribution-portable`へ昇格した
- `publisher.config.json` で入力CSV、公開フラグ、QTCT出力、対象packageを宣言した
- `publishers:check` が管理入口、参照、公開状態、47地域出力を検査する
- distribution packageへの管理入口の再混入をportable/bundle検査で拒否する
- Playwrightで静的管理ページのCSV検証とプレビューを確認する
- `csvQtctPipeline.mjs` にCSV解析・正規化・QTCT生成を集約した
- browser publisherとNode buildが同じmanaged configと共通変換器を使用する
- `publishers:check` が共通変換器の48出力と生成済みQTCTのバイト一致を検査する
- File System Access API非対応環境向けに、50生成ファイルとmanifestをまとめる依存なしZIP出力を追加した
- PlaywrightでZIPダウンロード、エントリ数、主要パスを検証する
- managed configの`ui.manage`をcatalogへ伝播し、native mapからpublisherへ移動できるようにした
- publisherから元の地域・市区町村付きnative mapへ戻る導線を追加した
- ZIPに`publisher.archive.json`を同梱し、publisher IDと宣言エントリを固定した
- `publisher:import`でZIPを展開せず検査・適用できるようにした
- import時はCRC、パス脱出、重複、publisher契約、CSV再生成QTCTとのバイト一致を検査する
- 適用は一時ファイル経由で行い、`map:build`失敗時は元ファイルを復元する
- `publisher:import:check`で正常ZIPの受理と、CRCが正しい改変QTCTの拒否を検証する

次段の残作業:

- publisherの署名付きZIPと、適用を実行できる管理者認証・監査ログを設計する

## P21: 外部データの責務と更新契約

- 自前データと外部機関が正本を持つデータを分ける
- hostとportable runtimeから上流取得処理を切り離す
- クライアント数に比例して参照元アクセスが増えないようにする
- 失敗時は前回正常値を保持し、鮮度と出典を失わない

実装状態:

- `dataSource` で `self` / `external` / `sample` を区別する
- `static-snapshot` / `scheduled-snapshot` / `user-action-direct` を宣言する
- snapshotは`runtimeFetch: false`を必須にし、hostから取得処理を排除する
- external sourceのHTTPS出典と、local publisher非接続を検査する
- scheduled refreshの間隔、遅延、同時数、タイムアウト、最低取得率を検査する
- 全国河川カメラCLIが更新契約を読み、24時間内の再取得を拒否する
- 同CLIはリクエスト開始を250ms以上空け、同時数2、20秒タイムアウトで取得する
- 取得件数が前回の90%未満なら旧スナップショットを保持する
- 河川水位・道路通行情報は公式実時間情報ではなく`sample`と明記する
- 生成manifestにデータ所有者・配信・鮮度契約を保存する
- 定期取得のhealth manifestに最終試行、最終成功、件数、次回目安、失敗理由を記録する
- `staleAfterAt`を保存し、ジョブ停止時も利用側が期限切れを判定できるようにする
- `source-health:check`がhealth schemaとmanaged layerの契約一致を検査する
- health manifestはpublic mapへ同期し、更新ジョブだけが状態を書き換える
- catalogにhealth URLだけを伝播し、native mapはレイヤー固有知識なしに読み込む
- native mapはstatusと`staleAfterAt`から「最新」「期限切れ」「取得失敗」「状態不明」を表示する
- health取得失敗は地図起動を止めず、レイヤー行のバッジだけを状態不明にする
- Playwrightで実health manifestから期限切れバッジが導出されることを検証する
- catalogへ出典、配信方式、閲覧時取得の有無を安全な表示用metadataとして伝播する
- healthバッジから最終成功、データ更新、有効期限、次回目安、件数、失敗理由を行内展開できる
- 詳細には閲覧者ブラウザが参照元へ自動アクセスするかを明示する

次段の残作業:

- 公式データadapterが確定するまで、河川水位・道路通行情報を実時間情報として表示しない

## P22: native初期表示の軽量化

- native shellとSVGMap runtimeが同じContainerを重複取得・解析しない
- hidden animationはSVGMap本体のvisibility gateで読込を遅延する
- hidden layerのcontrollerを初期起動しない
- 起動時間、map resource数、転送量、読込layer、controllerを実ブラウザで計測可能にする

実装状態:

- native shellは生成済みcatalogを正本としてレイヤー一覧を作る
- catalog取得失敗時だけContainerを取得・XML解析する
- catalogへ表示判定に必要な`className`と`visible`を生成する
- `native-startup:check`がContainer重複取得、SVGMap visibility gate、
  controllerのvisible-only起動を検査する
- runtimeは起動後に`runtime:startupMetrics`を通知する
- native shellは`window.__svg3StartupMetrics`と`svg3:startupMetrics`イベントを公開する
- 計測結果のlayer IDはSVGMap内部`iid`ではなくContainerの公開IDへ正規化する
- hidden全国レイヤーのQTCT取得0件を確認するPlaywright回帰テストを追加した

次段の残作業:

- 実ブラウザ計測値から初期表示のresource/byte/time予算を決める
- Chromium実行環境へ`libnspr4.so`等を導入し、追加済みE2Eを実測する

## P23: 地区境界SVGの地域単位配信

- 767MBの地区SVGを`frontend/public`から生成正本へ移す
- 旧`/data/{regionId}/districts-svg/{code}.svg` URLは維持する
- 配信時は対象地域だけをpublicへ同期できるようにする
- 地域ごとの件数・容量・ファイル一覧をmanifest化する

実装状態:

- 正本を`map/data/districts/{regionId}/`へ移した
- 47地域、1,896 SVG、769,956,537 bytesを地域別`assets.json`と全国`index.json`へ索引化した
- 地区SVG生成器と監査スクリプトは正本だけを読み書きする
- `assets:prepare -- --district-region <regionId>`で地域単位同期できる
- `assets:prepare -- --all-districts`で全国配信も明示的に選べる
- 通常buildは`SVG3_DISTRICT_REGIONS`を使い、未指定時は岡山だけを配信する
- 岡山配信では`public/data`を約767MBから約19MBへ縮小した
- `districts:check`が索引、実ファイル、自治体metadataの旧URLを検査する
- `assets:check`が配信manifest、ファイル存在、サイズ、`public/map`への二重混入を検査する
- `districts:stage -- --region <id>`が地域単位の配布artifactと`release.json`を生成する
- managed layerは`{districtBaseUrl}`を宣言し、Container生成時の
  `SVG3_DISTRICT_PUBLIC_BASE`で同一originまたはHTTPS CDNへ切り替えられる
- `{code}`はContainer生成後もレイヤー内の地区コードテンプレートとして保持する

次段の残作業:

- 全国公開環境では生成済み地域artifactをCDNへdeployし、長期cacheとCORS headerを設定する
- portable bundleで地区重心配置が必要な場合だけ対象地域subsetを同梱する

## P24: 全国河川カメラ台帳の配布

- 閲覧者ごとの一覧取得を禁止し、publisherだけが公式一覧を更新する
- 台帳更新は運用者起動かつ週1回までとし、リクエスト間隔と同時数を制限する
- 既存メタデータを再利用し、新規・欠損カメラだけ個別取得する
- 前回の90%未満になる不完全スナップショットは公開しない
- QTCT、検索索引、healthを静的配布artifactへまとめる

実装状態:

- `webcams:release`が取得、QTCT生成、検査、artifact作成を一括実行する
- 通常更新は`--if-due`で期限内の公式アクセスを省略する
- 全件メタデータ更新は明示的な`--refresh-metadata`指定時だけ実行する
- 配布artifactは画像を保持せず、101 JSON・約35MBのカメラデータだけを含む
- GitHub Actionsは手動起動時だけartifactを生成し、同時実行を1件へ制限する
- `webcams:automation:check`が負荷制限と自動化契約を検査する

次段の残作業:

- 本番の静的ホストまたはCDN資格情報を設定し、生成artifactのdeploy stepを接続する
- 許諾された配信元へ切り替えるまで、一般向けWebページの定期取得は行わない

## P25: 河川危険度の準リアルタイム配信

- カメラ台帳と洪水検知を分離する
- 河川情報数値データ配信事業など、定常取得が許諾された入力だけを利用する
- publisherが水位、水位変化、水位到達、洪水予報を5～10分間隔で1回だけ取得する
- 閲覧者は生成済みQTCTをCDNから読み、公式配信元へ一斉接続しない
- 観測時刻、取得時刻、欠測、遅延、出典を必ずfeatureへ保持する
- 危険段階の上昇時はレイヤー表示と通知候補を生成し、カメラは確認材料として関連付ける

実装状態:

- provider非依存の`input.schema.json`と検査fixtureを追加した
- publisherが水位閾値からnormal/advisory/evacuation/dangerを算出する
- 欠測、20分超の観測遅延、未来時刻、ID重複、座標不正を拒否・分離する
- 前回件数の90%未満または有効な最新観測が0件なら公開を拒否する
- `river-alerts:release`が入力適用、QTCT、検索、health、静的releaseを一括生成する
- 途中失敗時は前回のソースと生成データへロールバックする
- releaseは120秒cacheと10分のstale-while-revalidateを宣言する
- 河川水位entrypointだけが表示中・オンライン時に2分間隔でCDN上のQTCTを再検証する
- 再検証失敗時はruntime Cache APIに保存した前回データを継続表示する
- managed layerが汎用`ui.alertFeed`で通知summary URL、間隔、期限を自己宣言する
- publisherが危険段階別件数、最大段階、観測時刻、上位地点を軽量summaryへ出力する
- native shellはcatalogだけを読み、20分以内のadvisory以上を地図上部へ通知する
- 通知の「地図で確認」は宣言元レイヤーをONにし、最優先地点へ移動する
- 閉じた通知は同一内容だけを抑止し、段階または対象地点が変われば再表示する
- provider adapterはネットワークを使わず、契約済み受信daemonのローカル入力だけを変換する
- adapter SPIはversion、最大入力容量、入力安定待ち、source IDをmanifestで宣言する
- provider runnerは単一実行lock、size/mtime安定確認、SHA-256付き受け渡しを行う
- `normalized-json` reference adapterと、正常入力・lock競合・lock解放の回帰検査を追加した
- ローカル静的ホスト向けdeploy adapterが全releaseファイルのSHA-256とpathを再検証する
- deploy先marker、単一実行lock、古いsnapshot拒否、同時刻content競合拒否を実装した
- データ、alert summary、release manifestの順で切り替え、途中失敗時は変更前へ戻す
- 改ざん、path traversal、lock競合、途中失敗、古いreleaseの回帰検査を`map:build`へ追加した
- deploy先はmanifestとmoduleからなるSPIで走査し、共通runnerがrelease検証後に呼び出す
- `local-static`をnetwork不要の参照deployerとし、従来CLIは同じrunnerへのaliasにした
- network deployerはmanifest宣言、`--allow-network`、必須環境変数をすべて要求する
- deployer module逸脱、未宣言network利用、export契約をビルド時に検査する

次段の残作業:

- 配信事業者との契約・配信形式・対象地域・利用条件を確定する
- 配信事業者固有の電文を共通入力JSONへ変換するadapterを実装する
- 本番のCDNまたはobject storageを確定し、資格情報を持つ専用deploy adapterを接続する
