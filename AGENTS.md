# AGENTS.md

Claude Code スキル `design-studio` の本体。利用者は clone するだけで使い、`node` が `.ts` を直接実行する (型ストリッピング)。
**実行時の依存は持たない。** 開発用の道具だけを devDependencies に入れる。

## コマンド

| コマンド                            | 内容                                            |
| ----------------------------------- | ----------------------------------------------- |
| `pnpm install`                      | 開発用の道具を入れる (スキルを使うだけなら不要) |
| `pnpm lint`                         | ESLint (型情報つき、循環的複雑度の上限 10)      |
| `pnpm format` / `pnpm format:check` | Prettier で整える / 確かめる                    |
| `pnpm typecheck`                    | `tsc --noEmit`                                  |
| `pnpm test:unit`                    | `node --test`                                   |
| `pnpm check`                        | 上の検査をすべて通す。commit 前に必ず実行する   |

## 構成

- `core/`: 純粋な処理 (型・パス解決・共通の読み書き)
- `scripts/`: CLI (`studio.ts` と `scripts/commands/`)
- `skeletons/`: 画面の種類 × 配置の型ごとの骨組み
- `app/`: ローカルの Web アプリ (サーバーと画面)、`claude` CLI の呼び出し
- `data/`: 台帳とスタイル
- `gallery/`: 見本ページ (生成物)
- `docs/`: 仕様と ADR

## 守ること

- 実行時の依存 (dependencies) を足さない。外部入力の検証は手で書く
- import には拡張子 `.ts` を付け、型だけの import は `import type` にする。`enum` / `namespace` / 引数プロパティは書かない (型ストリッピングで動かないため。tsconfig の `erasableSyntaxOnly` で止まる)
- ルールを緩めて検査を通さない。lint の無効化コメント (`eslint-disable`) や `@ts-ignore` は書かない
- node は `fnm exec --using=26 <コマンド>` で実行する
