// 商品詳細の骨組み 3 種 (左右分割・格子・縦の読み物)。完成品ではなく、配置の違いを見せるためのもの
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

// copy に無い商品の価格の見本。配置の違いを見せるための固定の値 (参照: docs/adr/0001-skeleton-previews-llm-pages.md)
const PRICE = "¥3,800";

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

/** 左右分割: 左に商品の画像の枠・右に名前と価格と購入ボタン。下に copy.items を特徴の行に */
export const split: Skeleton = ({ copy }) => {
  const rows = copy.items
    .map(
      (item) => `<section class="border-b border-border p-8">
  <h3 class="font-heading text-xl">${escapeHtml(item.title)}</h3>
  <p class="mt-2 text-muted-foreground">${escapeHtml(item.body)}</p>
</section>`,
    )
    .join("\n");
  return `${nav(copy)}
<section class="mx-auto grid max-w-5xl items-center gap-8 p-12 md:grid-cols-2">
  <div class="aspect-square rounded-lg bg-muted shadow-md"></div>
  <div>
    <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
    <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
    <p class="mt-2 font-mono text-3xl">${PRICE}</p>
    <p class="mt-4 text-muted-foreground">${escapeHtml(copy.lead)}</p>
    <a href="#" class="mt-6 inline-block rounded-md bg-primary p-4 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
  </div>
</section>
<div class="mx-auto max-w-5xl">
${rows}
</div>
${footer(copy)}`;
};

/** 格子: 画像の枠を格子に並べ、下に説明 (copy.items の 1 件を 1 枠に)。上の帯に題と購入ボタン */
export const gallery: Skeleton = ({ copy }) => {
  const cards = copy.items
    .map(
      (item) => `<figure class="overflow-hidden rounded-lg border border-border bg-card shadow-md">
  <div class="aspect-square bg-muted"></div>
  <figcaption class="p-4">
    <h3 class="font-heading text-lg">${escapeHtml(item.title)}</h3>
    <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  </figcaption>
</figure>`,
    )
    .join("\n");
  return `${nav(copy)}
<section class="p-12 text-center">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
  <p class="mx-auto mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <a href="#" class="mt-8 inline-block rounded-md bg-primary p-4 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
</section>
<section class="mx-auto grid max-w-5xl gap-6 p-8 md:grid-cols-3">
${cards}
</section>
${footer(copy)}`;
};

/** 縦の読み物: 画像の枠から始め、copy.items を特徴の節にした縦に長い 1 段。末尾に購入ボタン */
export const story: Skeleton = ({ copy }) => {
  const sections = copy.items
    .map(
      (item, index) => `<section id="feature-${index + 1}" class="mt-8 border-t border-border pt-8">
  <h2 class="font-heading text-xl">${escapeHtml(item.title)}</h2>
  <p class="mt-2 text-muted-foreground">${escapeHtml(item.body)}</p>
</section>`,
    )
    .join("\n");
  return `${nav(copy)}
<article class="mx-auto max-w-prose p-16">
  <p class="font-mono text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-2 font-mono text-2xl">${PRICE}</p>
  <div class="mt-8 aspect-video rounded-lg bg-muted"></div>
  <p class="mt-8 text-muted-foreground">${escapeHtml(copy.lead)}</p>
${sections}
  <a href="#" class="mt-12 inline-block rounded-md bg-primary p-4 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
</article>
${footer(copy)}`;
};
