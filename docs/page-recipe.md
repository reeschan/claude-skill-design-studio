# ページを作る手順

design-studio でページ (1 ファイルの HTML) を作る手順。見本帳の見本もこの手順で作る。`<スキル>` は、このスキルのディレクトリを表す。

作業用のファイル (Direction・テーマ・HTML) は、スクラッチパッドか一時ディレクトリに置く。

## 1. 入力をそろえる

- **方向性 (Direction)**: 決まったものを `direction.json` に書く。形は `<スキル>/core/types.ts` の `Direction`
- **画面の種類 (page type)**: 候補の名前 (LP・ダッシュボード・ブログ記事・料金ページ・商品詳細・ポートフォリオ・設定画面) か、自由な名前。自由な名前には、当てる骨組みの種類 (`lp` / `dashboard` / `blog` / `pricing` / `product` / `portfolio` / `settings`) が要る
- **依頼**: 利用者の依頼。文章と雰囲気の元にする

## 2. テーマを作る

`node <スキル>/scripts/studio.ts theme --direction <direction.json>` を実行する。見本帳のスタイルから始めるときは `--style <id>`。応答の `cssForPage` (先頭の `@import "tailwindcss";` を除いた CSS) と `fontsUrl` をページに使う。`failed` が 0 でなければ、コントラストの結果を利用者に伝える。

プロジェクトに保存するときは、応答の `css` を `theme.css` というファイルに書いておく (手順 5 で使う)。

## 3. 1 ファイルの HTML を書く

`direction.layouts[<骨組みの種類>]` の配置の型を出発点に、骨組みより作り込んだページを書く。次の形を守る (`check-page` の前提)。

<!-- prettier-ignore -->
```html
<!doctype html>
<html lang="ja" data-theme="<themeId>" data-mode="<light|dark>">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ページの題</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="<fontsUrl>" id="theme-fonts">
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13"></script>
    <style type="text/tailwindcss" id="theme">
      <cssForPage>
    </style>
  </head>
  <body class="bg-background font-sans text-foreground">
    <!-- 中身: 画面の種類と依頼に合わせて作り込む -->
  </body>
</html>
```

決まり:

- `data-theme` は `theme --direction` の `themeId`、`data-mode` は `light` か `dark` (方向性の `seed.baseMode`。利用者の希望で変えてよい)。
- head の順は上のとおり。CSP の meta は値も位置もそのまま置く (`check-page` がこの形を見る)。外部からの読み込み先は、この CSP でブラウザ側に縛らせる。
- インラインの `<script>` と `on*=` 属性は使わない (CSP で止まる)。ページは見た目の見本で、動きは CSS だけで表す。
- 色・角丸・影・フォント・余白は、テーマのユーティリティで指定する: `bg-background` `text-foreground` `bg-card` `text-card-foreground` `bg-primary` `text-primary-foreground` `bg-secondary` `bg-muted` `text-muted-foreground` `border-border` `bg-accent` `text-accent-foreground` `bg-brand-accent` `ring-ring` `rounded-sm|md|lg` `shadow-md` `font-heading` `font-sans` `font-mono`。ユーティリティでは透明度 (`bg-card/60` など) と `backdrop-blur-*` を使ってよい。余白は `p-4` のような通常のものを使う (テーマの `--spacing` が効く)。色の直書き (`#fff`・`bg-blue-500` など) はしない。
- テーマの style (`<style type="text/tailwindcss" id="theme">`) とは別に、自分で書く `<style>` を、テーマの style のあとに置いてよい。ふつうの CSS で、`@keyframes`・`@property`・`backdrop-filter`・`mask` を書いてよい。色はそこでもテーマの CSS 変数 (`var(--primary)` など) か、それを `color-mix()` で薄めたものだけにする。
- 動き (`@keyframes`・`animation`・`transition`・`animate-*`・`transition*`) を使うときは、`@media (prefers-reduced-motion: reduce)` か Tailwind の `motion-safe:`・`motion-reduce:` で、止めるか弱める指定を必ず置く (`check-page` の `motion` が見る)。
- Chromium だけの機能 (`sibling-index()`・scroll-triggered animations・`corner-shape`・SVG フィルタの屈折) は、`@supports` で無いときの見た目を用意したときだけ使う。
- 画像は使わず、CSS のグラデーションとインラインの SVG (`data:` の画像は可) で表す。`mailto:`・`tel:` のリンクと、同じページ内の参照 (`#top` など) は置いてよい。
- 文章は、依頼から推し量った日本語にする。見出し・リード・ボタン・一覧の項目まで、中身のある文で埋める。
- frontend-design の考え方に沿う: テンプレートっぽさを避け、主題に合う大胆な見出しを 1 つ置き、意図のある余白とリズムを作り、細部 (角丸・字間・押したときの反応) の一貫性を保つ。

### 表現を効かせる

表現 (面と動き) を指定されたときは、ページにも効かせる。指定が無ければ、面・動きとも指定しない (今までどおり)。

- **面**: `node <スキル>/scripts/studio.ts treatments` で出る面の台帳から選んだ 1 件の `instructions` に従って面を作る。`name` と `description` も見て、カード・ボタン・ナビなどページ全体の面の作り方をそろえる。`none` なら面を指定しない。
- **動き**: 動きの強さで線を引く。`none` は動かさない (フォーカスの表示だけ)。`subtle` はホバー・押下・開閉の短い `transition` だけ (0.3 秒くらいまで)。ずっと動き続けるもの・スクロールに連動するものは使わない。`animated` でもページ全体には広げない。利用者が指したセクション (と要素) だけに、動きの entry を 1 件ずつ効かせる。主役は 1 セクションあたり 1 つ、ページ全体でも 2〜4 件まで。
- **動きの entry**: 言い方はゆるくてよい。`node <スキル>/scripts/studio.ts normalize-motion --section <section> [--target <target>] [--reason "<理由>"] "<言い方>"` で、辞書の ID に正規化した JSON を得る。形は次のとおり。きっかけが違うときは `target` ごとに複数件になる。`errors` が返ったら、その日本語に従って言い方を直す。辞書に無い ID は使わない。

```json
{
  "section": "hero",
  "target": "bg",
  "trigger": "scroll-linked",
  "effect": ["parallax"],
  "impl": "css-sda",
  "css_only": true,
  "reason": "ヒーローの背景だけ、奥行きをゆっくり出したい",
  "reduced_motion": "static",
  "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
  "animated_properties": ["transform", "opacity"]
}
```

- `trigger` は `on-enter` / `scroll-linked` / `pinned` / `velocity` / `navigation`。`effect` は辞書の ID を 1〜2 個。`reduced_motion` は `static` (最後の状態) / `opacity-only` (移動をやめ透明度だけ) / `native` (ふつうのスクロールに戻す)。`reason` が書けない動きは入れない。
- **動きの見本**: entry の `effect` に入った見本を、その `section` (と `target`) にだけ使う。見本の CSS は写さず、`technique` を元にテーマの色で書き直す。`support` が `fallback` の見本は、`@supports` で無いときの見た目を用意する。どの見本も entry の `reduced_motion` と見本の `reducedMotion` のとおりに、止めるか弱める指定を置く。`css_only` が false の効果は、スクリプトの無いページでは最終の見た目 (reduced-motion と同じ) にする。
- **DESIGN.md**: `node <スキル>/scripts/studio.ts motion-dictionary --markdown` が辞書の Motion 節を返す。正規化の結果を足すときは `normalize-motion --markdown`。この節を DESIGN.md に置くと、impeccable の `/impeccable animate <section>` が、entry の `reason` と `reduced_motion` を読んでそのセクションだけを動かせる。

## 4. 点検する

`node <スキル>/scripts/studio.ts check-page --html <file>` を実行し、`ok` が true になるまで直す。false のときは `disallowed` (許可していない外部 URL)・`hasCsp`・`hasThemeStyle` を見て直す。

`motion` は動きの点検。`hasMotion` が true (動きがある) のに `hasReducedMotion` が false (reduced-motion の指定が無い) なら、`ok` は false になる。`@media (prefers-reduced-motion: reduce)` か `motion-safe:`・`motion-reduce:` で、止めるか弱める指定を足す。

`check-page` は補助の lint で、ブラウザと同じ解釈を完全には再現しない。読み込み先を実際に縛るのは CSP の meta。

## 5. 保存する

`node <スキル>/scripts/studio.ts project save --project <project.json> --theme-css <theme.css> --page-name <画面の種類の名前> [--family <骨組みの種類>] --html <file>` で保存する。`--page-name` が候補の名前なら `--family` は要らない (その候補の骨組みの種類になる)。自由な名前のときは `--family` が要る。`project.json` の形は `<スキル>/core/types.ts` の `Project` (版 2: 依頼・回・混ぜ方の点・微調整を持つ。版の無い古い形は読むときに直す)。`id` は `/^[a-z0-9][a-z0-9-]{0,39}$/`。

見本帳の見本を作るときは、プロジェクトではなく `<スキル>/gallery/<styleId>/<family>.html` (骨組みの種類の名前) に置く。

面ごとの部品帳は `<スキル>/gallery/surfaces/<面の id>.html` に置く (面の id は `data/surfaces.json` の `none`・`material`・`glass`・`solid`)。スタイルはミニマル (`data-theme="minimal"`・`data-mode="light"`) に固定し、動きは `none`、同じ依頼・同じ部品・同じ文言と見本データのまま面だけを変える。

## 6. 部品帳と部品を作る

部品帳と部品も、ページと同じく 1 ファイルの HTML。ページと同じ殻 (3 節の形) をそのまま使い、CSS の決まりと「表現を効かせる」に従う。

- **部品帳**: 次の 10 個を 1 枚に並べた 1 ファイルの HTML。並びもこのとおりにする。
  1. ボタン
  2. 入力欄 (テキスト・選択・チェック・スイッチ)
  3. カード
  4. ヘッダーのナビ
  5. タブ
  6. バッジ/タグ
  7. モーダル
  8. トースト
  9. 表
  10. 料金カード
- **部品**: 上の 10 個から 1 つ選ぶか、自由な名前で 1 つ作る。その部品だけを並べる。

部品ごとに日本語の見出しを付ける。表は数行の見本データ、料金カードは 2〜3 プランにする。

### 見せ方

状態は 2 段で見せる。

1. **止まった見本**: 状態 (通常・ホバー・押下・フォーカス・無効) ごとに並べ、その状態の見た目をクラスで固定する。
2. **触れる見本**: 実際にホバー・押下・フォーカスできる見本。手触りは CSS (`:hover`・`:active`・`:focus-visible`・`details`・`popover` 属性) だけで出す。

- モーダルとトーストは、開いた状態を枠 (`position: relative` の箱) の中に置く。画面全体に `position: fixed` で被せない。
- 大きさの違い (S / M / L) がある部品は、大きさごとに並べる。
- スクリプトは使わない。

### 点検する

ページと同じく `node <スキル>/scripts/studio.ts check-page --html <file>` を実行し、`ok` が true になるまで直す。

### 保存する

- 部品帳: `node <スキル>/scripts/studio.ts project save --project <project.json> --theme-css <theme.css> --component-sheet --html <file>`
- 部品: `node <スキル>/scripts/studio.ts project save --project <project.json> --theme-css <theme.css> --component <名前> --html <file>`

部品帳は作り直すと上書きする。部品は名前ごとに別の 1 件として残る。どちらもページの保存とは別の 1 件になる。

## 7. デザインガイドを作る

デザインガイドは、1 つのプロジェクトの見た目と言葉の決まりを、持ち出せる形にまとめた 1 つのフォルダ。次の 5 ファイルからなる。

- `design-guide.md`: トンマナ・表現・部品の使い方の文書 (design-studio が組み立てる)
- `style-guide.md`: スタイルガイド (style-guide が作る。design-studio も Claude も手を加えない)
- `component-sheet.html`: 部品帳
- `theme.css`・`theme.json`: テーマ

`design-guide.md` の形は design-studio が組み立てる。Claude が書くのは部品帳の HTML と、下の値の JSON だけで、Markdown は書かない。

### 部品帳を作る

部品帳は 6 節どおりに作り、`node <スキル>/scripts/studio.ts check-page --html <file>` で `ok` が true になるまで直す。この HTML がデザインガイドの `component-sheet.html` になる。

### 値の JSON を書く

トンマナと部品の使い方を、1 つの JSON (`values.json`) に書く。決まったキーだけを置き、次の決まりを守る。

- 文字数は trim した後の値で、コードポイント (`[...s].length`) で数える
- 値の文字列に改行と制御文字 (U+0000〜U+001F・U+007F) を入れない。JSON を整えるための改行と字下げはよい
- `components` はちょうど 10 件。`id` は部品帳の順 (button / input / card / nav / tabs / badge / modal / toast / table / pricing-card) にする

| キー                         | 中身                                | 決まり                                                 |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `tone.words.voice`           | 口調 (例「です・ます」)             | 1〜80 文字                                             |
| `tone.words.style`           | 文体 (文の長さ・語尾・記号の使い方) | 1〜200 文字                                            |
| `tone.words.useWords`        | 使う言葉                            | 1〜12 件、各 1〜40 文字                                |
| `tone.words.avoidWords`      | 避ける言葉                          | 1〜12 件、各 1〜40 文字                                |
| `tone.words.examples`        | 文言の例                            | 1〜8 件。`situation` 1〜40 文字・`text` 1〜200 文字    |
| `tone.visual.keywords`       | 性格を表すキーワード                | 3〜5 件、各 1〜20 文字                                 |
| `tone.visual.treatmentUsage` | 表現 (面と動き) の使いどころ        | 1〜8 件、各 1〜200 文字                                |
| `tone.visual.avoid`          | 見た目で避けること                  | 1〜8 件、各 1〜200 文字                                |
| `components`                 | 部品ごとの使い方                    | 10 件。`id`・`purpose`・`states`・`whereToUse`・`dont` |
| `components[i].purpose`      | 用途                                | 1〜300 文字                                            |
| `components[i].states`       | 状態                                | 1〜300 文字                                            |
| `components[i].whereToUse`   | 使いどころ                          | 1〜300 文字                                            |
| `components[i].dont`         | してはいけないこと                  | 1〜300 文字                                            |

短い例:

```json
{
  "tone": {
    "words": {
      "voice": "です・ます",
      "style": "1 文を短くし、語尾をそろえる。感嘆符と絵文字は使わない。",
      "useWords": ["できます", "安心", "かんたん"],
      "avoidWords": ["しなければならない", "最強", "絶対"],
      "examples": [
        { "situation": "保存ボタン", "text": "保存する" },
        { "situation": "通信エラー", "text": "通信できませんでした。時間をおいて、もう一度お試しください。" }
      ]
    },
    "visual": {
      "keywords": ["落ち着き", "余白", "静か"],
      "treatmentUsage": ["カードの面はうっすら透けさせ、背景になじませる", "押したときは短い transition で反応を返す"],
      "avoid": ["強いグラデーション", "画面の端まで動き続ける装飾"]
    }
  },
  "components": [
    {
      "id": "button",
      "purpose": "画面の主な操作を 1 つに絞って示す",
      "states": "通常・ホバー・押下・フォーカス・無効",
      "whereToUse": "フォームの送信と、一覧から 1 件を選ぶとき",
      "dont": "1 つの画面に主なボタンを 2 つ以上並べない"
    }
  ]
}
```

例の `components` は 1 件だけ。`input`・`card`・`nav`・`tabs`・`badge`・`modal`・`toast`・`table`・`pricing-card` も同じ形で続けて…10 件にする。

### フォルダを組み立てる

`node <スキル>/scripts/studio.ts design-guide (--direction <file> | --style <id>) --sheet <file> --values <file> --out <dir> [--treatment '<JSON>']` を実行する。

- `--direction` と `--style` はどちらか 1 つ (`theme` と同じ読み方)。`--style` は見本帳のスタイルの id
- `--sheet` は部品帳の HTML、`--values` は値の JSON、`--out` は書き出すフォルダ。この 3 つは必須
- `--treatment` は表現の JSON の文字列 (`mix` の `--points` と同じくインラインで渡す。例 `'{"surface":"glass","motion":"subtle","motionSamples":[]}'`)。省くと指定しない

出力の `styleGuide` と `notice` を見る。

- `styleGuide` が `ok`: 5 ファイルが書かれている
- `styleGuide` が `outdated`: style-guide が古い。部品帳とテーマ (`component-sheet.html`・`theme.css`・`theme.json`) だけが書かれ、`design-guide.md`・`style-guide.md` は作られない。利用者に「style-guide を更新するとデザインガイドも作れます」と伝える

### 保存する

`node <スキル>/scripts/studio.ts project save --project <project.json> --design-guide <dir>` で保存する。`--design-guide` は `--out` のフォルダ。`--page-name`・`--component`・`--component-sheet`・`--html` とは一緒に使えない。

デザインガイドはプロジェクトに 1 件で、作り直すと置き換わる。古い style-guide で 3 ファイルになったときは、前の `design-guide.md`・`style-guide.md` は消える。

## 8. 点検と仕上げ (必要に応じて)

点検のスキル (Call the Skill tool with "fixing-accessibility" など) と仕上げのスキル (Call the Skill tool with "make-interfaces-feel-better" など) を段階に応じて使う。
