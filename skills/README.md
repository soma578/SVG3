# SVG2 / SVG3 Project Skills

このディレクトリは、SVG2 / SVG3 防災マッププロジェクトを AI エージェントに
読ませる用の skills 一式です。

## 含まれるもの

| Skill | 内容 |
|---|---|
| `project-overview/SKILL.md` | プロジェクト全体像。**README/docs と実態のズレ（MapLibre は無い）** を最初に潰すための skill。何か始める前に必読。 |
| `map-postmessage-contract/SKILL.md` | iframe ↔ React の postMessage 契約。両側のファイルを同期させるルール、origin の扱い、メッセージ早見表。地図関連の変更ではほぼ必ず読む。 |
| `adding-a-map-layer/SKILL.md` | 新しいレイヤー追加 or 既存レイヤー改修。`payloadFor`、`normalizeStatus`、`buildXxxFeatureDetail` のテンプレ。 |
| `region-onboarding/SKILL.md` | 新しい都道府県を追加する手順。allowlist の落とし穴、`runtime-config.json` の中身、`okayama` ハードコード箇所のリスト。 |

## エージェント別の使い方

### Claude（Claude.ai / Claude Code）の場合

そのまま `SKILL.md` を読ませる。`description` を見て自動で発火するので、
`.claude/skills/` か、プロジェクト直下の `skills/` に置けば良い。具体的な
配置は環境次第。

### Codex（OpenAI）の場合

Codex は `AGENTS.md` をプロジェクトディレクトリで自動的に読む仕様。3 通り：

1. **全部連結して `AGENTS.md` 1 本にする**（一番簡単）
   ```bash
   cat skills/project-overview/SKILL.md \
       skills/map-postmessage-contract/SKILL.md \
       skills/adding-a-map-layer/SKILL.md \
       skills/region-onboarding/SKILL.md \
     > AGENTS.md
   ```
   YAML frontmatter は残しておけば人間が読むときの見出しになる。Codex は
   無視して読み進める。

2. **ディレクトリごとに `AGENTS.md` を置く**（Codex の階層読みを活かす）
   - `frontend/AGENTS.md` ← `adding-a-map-layer` の React 部分 + `region-onboarding`
   - `map/AGENTS.md` ← `map-postmessage-contract` + `adding-a-map-layer` の iframe 部分
   - リポジトリ直下の `AGENTS.md` ← `project-overview`

   Codex は作業ディレクトリの近くにある `AGENTS.md` を優先的に読むので、
   コンテキスト窓を節約できる。

3. **`SKILL.md` のままシンボリックリンクで `AGENTS.md` を作る**
   ```bash
   cd skills/project-overview && ln -s SKILL.md AGENTS.md
   ```
   フォーマットは Markdown だから、frontmatter があっても Codex は壊れない。

### その他のエージェント

frontmatter を捨てて純粋な Markdown として `docs/` に置いても十分有用。

## 更新ルール

- `docs/map-runtime-contract.md` を更新したら、`map-postmessage-contract`
  skill も同じ変更を反映する（重複しているけど、protocol 変更で skill が
  ズレると AI が古い前提で動く）
- `mapMessages.js` / `mapMessages.ts` に messages を追加したら、両ファイル
  を同期したことを skill に書き残す
- `frontend/src/lib/allowedRegions.ts` を変更したら、
  `region-onboarding` skill の「現在 allowlist にあるリージョン」を更新

## なぜ docs/ の代わりに skills/ なのか

- `docs/legacy/01_overview.md`、`02_frontend.md`、`06_svgmap_lightweight.md`
  は **MapLibre 前提の履歴文書**（`native` の現状と合わない）
- AI エージェントが legacy 文書を現行仕様として読むと「MapLibre のコードを
  直そう」みたいな間違った提案をする
- skills/ は AI 専用の「現在の正本」として独立させ、人間向け docs/ とは
  別レーンにする

人間向け docs/ を更新するときも、まず skill 側を直して、それから docs/ を
作り直すのが安全。
