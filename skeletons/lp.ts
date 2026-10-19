// LP の骨組み 3 種 (中央寄せ・左右分割・全面の帯)。完成品ではなく、配置の違いを見せるためのもの
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

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

// ヒーローのボタン 2 つ
function heroActions(copy: Copy, center: boolean): string {
  const justify = center ? "justify-center" : "justify-start";
  return `<div class="mt-8 flex flex-wrap gap-4 ${justify}">
    <a href="#" class="rounded-md bg-primary p-4 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
    <a href="#" class="rounded-md border border-border bg-card p-4 text-card-foreground">詳しく見る</a>
  </div>`;
}

/** 中央寄せ: 中央のヒーローと、3 列のカード */
export const centered: Skeleton = ({ copy }) => {
  const cards = copy.items
    .map(
      (item) => `<article class="rounded-lg border border-border bg-card p-6 shadow-md">
  <h3 class="font-heading text-lg">${escapeHtml(item.title)}</h3>
  <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
</article>`,
    )
    .join("\n");
  return `${nav(copy)}
<section data-hero class="p-12 text-center">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
  <p class="mx-auto mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  ${heroActions(copy, true)}
</section>
<section class="mx-auto grid max-w-5xl gap-6 p-8 md:grid-cols-3">
${cards}
</section>
${footer(copy)}`;
};

/** 左右分割: 左に文章・右に図版のヒーローと、左右交互の行 */
export const split: Skeleton = ({ copy }) => {
  const rows = copy.items
    .map((item, index) => {
      const reverse = index % 2 === 1;
      return `<div class="grid items-center gap-8 border-b border-border p-8 md:grid-cols-2">
  <div class="${reverse ? "md:order-2" : ""}">
    <h3 class="font-heading text-xl">${escapeHtml(item.title)}</h3>
    <p class="mt-2 text-muted-foreground">${escapeHtml(item.body)}</p>
  </div>
  <div class="${reverse ? "md:order-1" : ""} h-32 rounded-lg bg-linear-to-br from-accent to-primary"></div>
</div>`;
    })
    .join("\n");
  return `${nav(copy)}
<section data-hero class="mx-auto grid max-w-5xl items-center gap-8 p-12 md:grid-cols-2">
  <div>
    <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
    <h1 class="mt-4 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
    <p class="mt-4 text-muted-foreground">${escapeHtml(copy.lead)}</p>
    ${heroActions(copy, false)}
  </div>
  <div class="aspect-square rounded-lg bg-linear-to-br from-primary to-accent p-6 text-primary-foreground shadow-md">
    <svg viewBox="0 0 240 240" class="h-full w-full" role="img" aria-label="図版" fill="none" stroke="currentColor" stroke-width="3">
      <circle cx="120" cy="120" r="84" />
      <path d="M48 168 L120 72 L192 168 Z" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  </div>
</section>
<div class="mx-auto max-w-5xl">
${rows}
</div>
${footer(copy)}`;
};

/** 全面の帯: グラデーションの帯に大きな見出しと、番号付きの縦並び */
export const fullbleed: Skeleton = ({ copy }) => {
  const rows = copy.items
    .map(
      (item, index) => `<li class="flex gap-8 border-b border-border p-8">
  <span class="font-mono text-3xl text-muted-foreground">${String(index + 1).padStart(2, "0")}</span>
  <div>
    <h3 class="font-heading text-2xl">${escapeHtml(item.title)}</h3>
    <p class="mt-2 text-muted-foreground">${escapeHtml(item.body)}</p>
  </div>
</li>`,
    )
    .join("\n");
  return `${nav(copy)}
<section data-hero class="bg-linear-to-br from-primary to-accent p-16 text-primary-foreground">
  <div class="mx-auto max-w-4xl">
    <p class="font-mono text-sm">${escapeHtml(copy.tagline)}</p>
    <h1 class="mt-4 font-heading text-5xl">${escapeHtml(copy.headline)}</h1>
    <p class="mt-6 max-w-2xl">${escapeHtml(copy.lead)}</p>
    <a href="#" class="mt-8 inline-block rounded-md bg-background p-4 text-foreground shadow-md">${escapeHtml(copy.cta)}</a>
  </div>
</section>
<ol class="mx-auto max-w-4xl list-none p-8">
${rows}
</ol>
${footer(copy)}`;
};
