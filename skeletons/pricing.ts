// 料金の骨組み 3 種 (並べるカード・比較表・おすすめ 1 枚)。完成品ではなく、配置の違いを見せるためのもの
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

// copy に無い価格の見本。配置の違いを見せるための固定の値 (参照: docs/adr/0001-skeleton-previews-llm-pages.md)
const PRICES = ["¥0", "¥1,200", "¥3,800", "¥6,500", "¥9,800", "¥15,000"];

// copy.items は 3〜6 件で PRICES を超えない。配る添字に応じて定義値を返す
function priceAt(index: number): string {
  return PRICES[index % PRICES.length] ?? "";
}

// 上部のナビ。ブランド名と 3 つのリンク
function nav(copy: Copy): string {
  return `<header class="border-b border-border">
  <nav class="mx-auto flex max-w-5xl items-center justify-between p-4">
    <span class="font-heading text-lg">${escapeHtml(copy.brand)}</span>
    <div class="flex gap-6 text-sm text-muted-foreground">
      <a href="#">特徴</a>
      <a href="#">使い方</a>
      <a href="#">料金</a>
    </div>
  </nav>
</header>`;
}

// 下部のフッター
function footer(copy: Copy): string {
  return `<footer class="border-t border-border bg-muted">
  <div class="mx-auto flex max-w-5xl items-center justify-between p-6 text-sm text-muted-foreground">
    <span>${escapeHtml(copy.brand)}</span>
    <a href="#" class="font-mono">トップへ</a>
  </div>
</footer>`;
}

// 見出しの帯。タグライン・題・導入を中央に置く
function heading(copy: Copy): string {
  return `<section class="p-12 text-center">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
  <p class="mx-auto mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
</section>`;
}

/** 並べるカード: プランのカードを横に並べる (copy.items の 1 枚 1 プラン)。カードには見本の価格と申込ボタンを置く */
export const tiers: Skeleton = ({ copy }) => {
  const cards = copy.items
    .map(
      (item, index) => `<article class="flex flex-col rounded-lg border border-border bg-card p-6 shadow-md">
  <h3 class="font-heading text-lg">${escapeHtml(item.title)}</h3>
  <p class="mt-1 font-mono text-3xl">${priceAt(index)}</p>
  <p class="mt-3 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  <a href="#" class="mt-6 rounded-md bg-primary p-3 text-center text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
</article>`,
    )
    .join("\n");
  return `${nav(copy)}
${heading(copy)}
<section class="mx-auto grid max-w-5xl gap-6 p-8 md:grid-cols-3">
${cards}
</section>
${footer(copy)}`;
};

/** 比較表: プランを列にした表。価格・内容の行で比べ、末尾の行に申込ボタンを置く */
export const table: Skeleton = ({ copy }) => {
  const head = `<th scope="col" class="p-4 font-heading text-sm text-muted-foreground">プラン</th>
${copy.items.map((item) => `<th scope="col" class="p-4 font-heading text-lg">${escapeHtml(item.title)}</th>`).join("\n")}`;
  const prices = `<th scope="row" class="p-4 text-sm text-muted-foreground">価格</th>
${copy.items.map((item, index) => `<td class="p-4 font-mono">${priceAt(index)}</td>`).join("\n")}`;
  const bodies = `<th scope="row" class="p-4 text-sm text-muted-foreground">内容</th>
${copy.items.map((item) => `<td class="p-4 text-sm text-muted-foreground">${escapeHtml(item.body)}</td>`).join("\n")}`;
  const actions = `<th scope="row" class="p-4 text-sm text-muted-foreground">申込</th>
${copy.items
  .map(
    () =>
      `<td class="p-4"><a href="#" class="inline-block rounded-md bg-primary p-3 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a></td>`,
  )
  .join("\n")}`;
  return `${nav(copy)}
${heading(copy)}
<section class="overflow-x-auto p-8">
  <table class="mx-auto w-full max-w-5xl border-collapse text-left">
    <thead>
      <tr class="border-b border-border">
${head}
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-border">
${prices}
      </tr>
      <tr class="border-b border-border">
${bodies}
      </tr>
      <tr>
${actions}
      </tr>
    </tbody>
  </table>
</section>
${footer(copy)}`;
};

/** おすすめ 1 枚: おすすめの 1 プラン (copy.items の 2 番目) を大きく出し、ほかのプランを下に小さく並べる */
export const spotlight: Skeleton = ({ copy }) => {
  const picks = copy.items.map((item, index) => ({ item, index }));
  const top = picks
    .filter(({ index }) => index === 1)
    .map(
      ({ item, index }) =>
        `<article class="grid items-center gap-6 rounded-lg border border-border bg-card p-6 shadow-md md:grid-cols-2">
  <div>
    <p class="rounded-md bg-primary p-2 text-center text-sm text-primary-foreground">おすすめ</p>
    <h3 class="mt-4 font-heading text-2xl">${escapeHtml(item.title)}</h3>
    <p class="mt-1 font-mono text-4xl">${priceAt(index)}</p>
    <p class="mt-3 text-muted-foreground">${escapeHtml(item.body)}</p>
    <a href="#" class="mt-6 inline-block rounded-md bg-primary p-4 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
  </div>
  <div class="aspect-video rounded-lg bg-muted"></div>
</article>`,
    )
    .join("\n");
  const small = picks
    .filter(({ index }) => index !== 1)
    .map(
      ({ item, index }) =>
        `<article class="rounded-lg border border-border bg-card p-4 shadow-md">
  <h3 class="font-heading text-sm">${escapeHtml(item.title)}</h3>
  <p class="mt-1 font-mono text-lg">${priceAt(index)}</p>
  <p class="mt-2 text-xs text-muted-foreground">${escapeHtml(item.body)}</p>
</article>`,
    )
    .join("\n");
  return `${nav(copy)}
${heading(copy)}
<section class="mx-auto max-w-5xl p-8">
${top}
  <div class="mt-6 grid gap-4 md:grid-cols-3">
${small}
  </div>
</section>
${footer(copy)}`;
};
