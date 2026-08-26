# SVGMap App Layers compatibility

上流の `svgMapAppLayers/Container.svg` にあるレイヤを、無条件に全搭載せず、
互換性を確認したものから標準搭載する。

## 正本

- `compatibility.json`: 上流Container内の全animationに対する互換性・依存・理由
- `import.config.json`: `supported` / `limited` の許可リスト
- `adapters/`: URL衝突回避や依存資産の同梱化に必要な薄い変換層

## 配信元側の停止・旧API終了（8件）

これはSVG3側の互換性失敗とは別枠である。対象と理由の正本は
`runtime-overrides.json` の `retiredSources`、画面表示用一覧はそこから生成する
`compatibility.json` の `retiredSources` とする。

- 海底ケーブル(海しる)
- 漁港(海しる)
- 等深線(海しる)
- 天気図４８時間予想(海しる)
- 天気図２４時間予想(海しる)
- 天気図現況(海しる)
- 防災科研　南海トラフ広域地震防災研究PF
- GPV降雨情報(MSM)

海しる6件は2026-08-26に本家SVGMap Demoでも再確認した。旧token APIが新ポータルの
HTMLへ転送され、上流controllerがJSONとして解析して停止するため、実データは生成されない。
残る2件も、旧WMSの404および旧アーカイブのblank画像転送という配信元側の停止である。

状態:

- `supported`: 動作確認済み
- `limited`: 動作確認済みだがオンラインサービス等へ依存
- `unverified`: 未確認。黙って非対応扱いにはしない
- `incompatible`: 必須ファイル・設定の欠落など、現在動かない理由を確認済み
- `requires-config`: API接続先など管理者設定後に利用可能
- `requires-proxy`: 本家と同様にアクセス先を制限したCORSプロキシが必要

`requires-config` はカタログに宣言された設定欄をGUIへ生成し、値をレイヤーURLの
ハッシュへ渡す。現在はGraphHopperのHTTPS APIエンドポイントに対応している。

`requires-proxy` は `/api/svgmap-proxy` を利用する。許可先はレイヤーごとの固定ホスト・
パスだけで、任意URLを転送するオープンプロキシではない。リダイレクト先、DNS、応答サイズ、
Content-Typeも検査する。SVGMap controllerからは本家と同じ `svgMap.getCORSURL()` を使う。

本家ContainerでXMLコメント内にあるanimationはカタログ対象外とする。カタログ各項目の
`animation` は本家の配置・class・hrefを保持し、GUIから1件だけ追加するときにも使う。

実行モード（コードの検証状態ではなく、配布境界で分ける）:

- 完全スナップショットとして同梱した `svgMapAppLayers` は、固定同一originの `tight`
- 利用者がURL・ファイルから追加する未知の資産は、引き続き `isolated`
- `tight` は同梱ツリー外のURLへは昇格させない

実行契約の正本は `compatibility-contract.json`。上流資産ツリーとSVGMap runtimeの
SHA-256、相対path、controller globals、document identity、network、cache方針を一組で固定する。

分類:

- A: 同一オリジンで完結する単純レイヤ
- B: controller・相対資産・固有URLアダプターが必要
- C: 外部API・CDN・CORS等へ依存
- D: 現在の配布物またはランタイムでは非互換

## 配置と依存資産の適合方法

上流ファイルを一律コピーするのではなく、実ブラウザで確認した次の方式を使い分ける。

| レイヤーの状態 | 配置方式 | 例 |
| --- | --- | --- |
| 単純なSVG | `publicBase` へrebaseして直接配置 | 静的ベクターレイヤー |
| 同じSVGを異なるhashで使う、またはルートscriptが必要 | `adapters/` に固有URLのSVGを生成 | DID、地理院写真、OSM |
| 相対controller・JS・画像がある | 原則 `/map/svgMapAppLayers/` の本家pathを維持 | 本家controller一般 |
| Gitのsymlinkが配布時に空ファイル化する | symlink先の共通ライブラリ実体をadapterへ展開 | 国交省浸水想定 |
| CORSを許可する外部API・タイル | 本体だけ同梱し、データはブラウザから直接取得 | JMA、USGS、地理院、OSM、J-SHIS |
| CORSを許可しない、または認証が必要 | 権限と利用規約を確認した専用中継か、提供者側CORSが必要 | 未検証のまま標準搭載しない |

`compatibility.json` の `adapterHref`、`controllerHref`、`externalDependencies` で
配置と通信先を明示する。上流Containerの配置範囲が対象SVGの座標系と合わない場合は、
`placement: { x, y, width, height }` でanimationの範囲を補正する。これはOSMのように
レイヤーをONにしても文書自体がロードされない問題を防ぐための互換情報である。

外部通信は静的抽出したhost/pathと `network-capability-overrides.json` からレイヤー別profileを
生成する。各profileが method / maxBytes / Content-Type / redirect / timeoutを持ち、profileに
無いURLは中継しない。外部依存を持つレイヤーは、通信先への実リクエストとSVG内の
`image` / `use` 生成までE2Eで確認する。汎用オープンプロキシは置かない。

adapterは、(1) 本家pathそのまま、(2) host compatibility、(3) document identity shimで
吸収できない場合の最後の手段とする。共有SVGを固有URL化する機械生成物は、上流forkではなく
`document identity shim`として扱う。

## 更新

```bash
cd frontend
npm run community-layers:catalog
npm run community-layers:check
npm run containers:generate
npm run assets:prepare
```

生成処理はSVG本体だけでなく、参照controller内の外部URLと欠落も調べる。
オフライン対応と宣言したアダプターに外部URLが残ると検査を失敗させる。
