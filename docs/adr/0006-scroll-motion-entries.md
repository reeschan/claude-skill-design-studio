# スクロールの動きは、ページ全体ではなくセクションの entry で指定する

Animated を選ぶと、これまでは見本をページ全体の土台にしていた。スクロールの動きは「ヒーローの背景だけ」のように場所が決まっているので、辞書の ID に正規化した entry を、そのセクション (と任意の対象) にだけ効かせる。言い方のゆれは別名で吸収し、候補が複数のときだけ Jev に当てはまりを採点させる。キーが無い、または Jev が失敗したときは別名の順のままにする。

検証に ajv は使わない。実行時の依存を足さない、というこのスキルの決まりに合わせ、entry の形ときっかけの相性は手で確かめる。見本はこれまでどおり CSS だけで、既存のプレビュー (`treatments motion` と見本帳) に載せる。JavaScript が要る効果も、見本は最終に近い見た目を CSS で出し、本番の補間や速度は entry の `css_only: false` で示す。

## Considered Options

- 言い方を毎回 LLM に解釈させる: 辞書に無い ID が混ざり、キーが無い CI で見本帳が止まる
- 38 種をページ全体の Animated に足すだけ: 場所を指定できず、今の「ページが全部動く」が残る
- ajv で schema を検証する: 実行時の依存になる

## Consequences

- 動きの見本は、既存の 12 件に辞書の効果を足した一覧になる。`stagger` と `line-draw` は元の見本を使い、別名だけ辞書に合わせる
- `normalize-motion` と `POST /api/motions/search` は、`TYPESAFE_API_KEY` または `~/.config/typesafe/credentials.json` が無いと別名検索だけになる。テストは `DESIGN_STUDIO_JEV_MOCK` で採点を差し替える
- DESIGN.md の Motion 節は `motion-dictionary --markdown` で出せる。entry の `reason` と `reduced_motion` を、impeccable の `/impeccable animate <section>` が読める
