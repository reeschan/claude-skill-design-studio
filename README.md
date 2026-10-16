# claude-skill-design-studio

曖昧な一言 (「なんとなく、落ち着いた感じで」) から、Web ページの見た目を具体化する Claude Code スキルです。
方向性の案を実際の骨組みで見比べて選び、配色・フォント・配置のテーマを作り、LP・ダッシュボード・ブログ記事のページ (1 ファイルの HTML) まで仕上げます。
テンプレートに頼らず、デザイン系のスキルを段階ごとに振り分ける親スキルです。

## 特長

- 言葉になっていないイメージから始められる。方向性の案を 3 つ、テーマと配置の違う骨組みで見比べる
- 色・フォント・形・配置の 4 つの軸で、案を混ぜて調整できる
- テーマは style-guide と共通の `theme.css` / `theme.json`。ほかの作業でも使い回せる
- できるページは 1 ファイルの HTML。外部の画像に頼らず、ダブルクリックで開ける
- 点検・仕上げのスキル (アクセシビリティ、講評、文言、動きなど) を台帳から選んで呼べる
- 同梱アプリ (台帳・見本帳・作業台) は手元の PC だけで動く。API キーは要らない

## 必要なもの

- Claude Code
- Node.js 22.18 以上 (`.ts` をそのまま実行するため。開発は v26)
- 任意: 傘下スキル (style-guide、design プラグインなど)。足りなければ design-studio が計画を示して導入する

## インストール

開発用リポジトリを clone してから、自己インストールのスクリプトを実行します。

```sh
git clone <リポジトリの URL> ~/dev/claude-skill-design-studio
cd ~/dev/claude-skill-design-studio
node scripts/install-self.ts
```

`~/.claude/skills/design-studio/` へ、スキルとして使う分 (CLI・同梱アプリ・台帳・スタイル・ページのレシピ) だけが写ります。テストや開発用のファイルは写りません。

- 写し先は環境変数 `DESIGN_STUDIO_INSTALL_DIR` で変えられます
- 写し直しは、目印 `.design-studio-install` のある置き先だけ。目印の無いディレクトリには書かず、終了コード 2 で止まります
- リポジトリを直したあとは、同じコマンドをもう一度実行すると写し直せます

## 使い方

Claude Code で呼び出します。

```text
/design-studio 落ち着いた感じの請求書 SaaS の LP
```

一言から、方向性の案 (骨組み) → テーマ → ページ → 点検の順に進みます。ほかの呼び方:

- `/design-studio app`: 同梱アプリ (台帳・見本帳・作業台) をブラウザで開く
- `/design-studio catalog`: 台帳 (傘下スキルの段階・役割・導入状態) を見る
- `/design-studio add <owner/skill>`: ui-skills.com から傘下スキルを台帳に足す
- `/design-studio install`: 足りない傘下スキルを入れる

CLI を直接使うこともできます。

```sh
node ~/.claude/skills/design-studio/scripts/studio.ts styles
```

## できあがるもの

- **ページ**: 1 ファイルの HTML。外部から読み込むのは Tailwind v4 のブラウザ版と Google Fonts だけで、画像は CSS と SVG で表します
- **テーマ**: style-guide が作る `theme.css` (Tailwind v4 の変数) と `theme.json`
- **プロジェクト**: `~/.claude/design-studio/projects/<id>/` に、依頼・方向性・テーマ・ページを保存します

## 開発

スキルとして使うだけなら不要です。開発には pnpm で検査用の道具を入れます。

```sh
pnpm install
pnpm check   # lint・書式・型・テストをまとめて通す
```

テストでは、style-guide や `claude` CLI は偽物に差し替わるので、本物は要りません。

構成:

- `core/`: 台帳・導入・方向性・テーマの橋渡し・ページの殻・プロジェクト・LLM 呼び出し (純粋な処理)
- `skeletons/`: 画面の種類 × 配置の型の骨組み
- `scripts/`: CLI (`studio.ts` と `scripts/commands/`)、自己インストール (`install-self.ts`)
- `app/`: ローカルの Web アプリ (サーバーと画面)
- `data/`: 台帳 (`catalog.json`) とスタイル (`styles.json`)
- `gallery/`: 見本ページ
- `docs/`: 仕様 (`docs/specs/design-studio.md`)・設計判断 (`docs/adr/`)・ページのレシピ (`docs/page-recipe.md`)
