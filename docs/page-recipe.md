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
- 色・角丸・影・フォント・余白は、テーマのユーティリティだけで指定する: `bg-background` `text-foreground` `bg-card` `text-card-foreground` `bg-primary` `text-primary-foreground` `bg-secondary` `bg-muted` `text-muted-foreground` `border-border` `bg-accent` `text-accent-foreground` `bg-brand-accent` `ring-ring` `rounded-sm|md|lg` `shadow-md` `font-heading` `font-sans` `font-mono`。余白は `p-4` のような通常のものを使う (テーマの `--spacing` が効く)。色の直書き (`#fff`・`bg-blue-500` など) はしない。
- 画像は使わず、CSS のグラデーションとインラインの SVG (`data:` の画像は可) で表す。`mailto:`・`tel:` のリンクと、同じページ内の参照 (`#top` など) は置いてよい。
- 文章は、依頼から推し量った日本語にする。見出し・リード・ボタン・一覧の項目まで、中身のある文で埋める。
- frontend-design の考え方に沿う: テンプレートっぽさを避け、主題に合う大胆な見出しを 1 つ置き、意図のある余白とリズムを作り、細部 (角丸・字間・押したときの反応) の一貫性を保つ。

## 4. 点検する

`node <スキル>/scripts/studio.ts check-page --html <file>` を実行し、`ok` が true になるまで直す。false のときは `disallowed` (許可していない外部 URL)・`hasCsp`・`hasThemeStyle` を見て直す。

`check-page` は補助の lint で、ブラウザと同じ解釈を完全には再現しない。読み込み先を実際に縛るのは CSP の meta。

## 5. 保存する

`node <スキル>/scripts/studio.ts project save --project <project.json> --theme-css <theme.css> --page-name <画面の種類の名前> [--family <骨組みの種類>] --html <file>` で保存する。`--page-name` が候補の名前なら `--family` は要らない (その候補の骨組みの種類になる)。自由な名前のときは `--family` が要る。`project.json` の形は `<スキル>/core/types.ts` の `Project` (版 2: 依頼・回・混ぜ方の点・微調整を持つ。版の無い古い形は読むときに直す)。`id` は `/^[a-z0-9][a-z0-9-]{0,39}$/`。

見本帳の見本を作るときは、プロジェクトではなく `<スキル>/gallery/<styleId>/<family>.html` (骨組みの種類の名前) に置く。

## 6. 点検と仕上げ (必要に応じて)

点検のスキル (Call the Skill tool with "fixing-accessibility" など) と仕上げのスキル (Call the Skill tool with "make-interfaces-feel-better" など) を段階に応じて使う。
