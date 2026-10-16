// ポートフォリオの骨組み 3 種 (格子・一覧・1 作品の大写し)。完成品ではなく、配置の違いを見せるためのもの
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

type CopyItem = Copy["items"][number];

// 上部のナビ。ブランド名と 2 つのリンクと、依頼のボタン
function nav(copy: Copy): string {
  return `<header class="border-b border-border">
  <nav class="mx-auto flex max-w-5xl items-center justify-between p-4">
    <span class="font-heading text-lg">${escapeHtml(copy.brand)}</span>
    <div class="flex items-center gap-6 text-sm text-muted-foreground">
      <a href="#">作品</a>
      <a href="#">について</a>
      <a href="#" class="rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
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

// 画像の代わりの灰色の枠。縦横比と大きさは呼ぶ側が決める
function frame(className: string): string {
  return `<div class="${className} rounded-lg bg-muted"></div>`;
}

// 先頭の 1 作品。全幅 (3 列ぶん) の大きな図版と題
function heroCard(item: CopyItem): string {
  return `<article class="md:col-span-3">
  ${frame("aspect-video w-full")}
  <div class="mt-6 flex flex-wrap items-baseline justify-between gap-4">
    <h2 class="font-heading text-2xl">${escapeHtml(item.title)}</h2>
    <p class="font-mono text-sm text-muted-foreground">代表作</p>
  </div>
  <p class="mt-2 max-w-2xl text-muted-foreground">${escapeHtml(item.body)}</p>
</article>`;
}

// 続いて並べる小さめのカード
function smallCard(item: CopyItem): string {
  return `<article class="rounded-lg border border-border bg-card p-4 shadow-md">
  ${frame("aspect-video w-full")}
  <h3 class="mt-4 font-heading text-lg">${escapeHtml(item.title)}</h3>
  <p class="mt-1 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
</article>`;
}

/** 格子: 作品のカードを格子に並べる。copy.items が 1 枚 1 作品 */
export const grid: Skeleton = ({ copy }) => {
  const cards = copy.items
    .map(
      (item, index) => `<article class="overflow-hidden rounded-lg border border-border bg-card shadow-md">
  ${frame("aspect-square w-full")}
  <div class="p-6">
    <p class="font-mono text-sm text-muted-foreground">${String(index + 1).padStart(2, "0")}</p>
    <h2 class="mt-2 font-heading text-xl">${escapeHtml(item.title)}</h2>
    <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  </div>
</article>`,
    )
    .join("\n");
  return `${nav(copy)}
<main class="mx-auto max-w-5xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <div class="mt-8 grid gap-6 md:grid-cols-3">
${cards}
  </div>
</main>
${footer(copy)}`;
};

/** 一覧: 作品を縦に並べる。左に画像の枠、右に説明 */
export const list: Skeleton = ({ copy }) => {
  const rows = copy.items
    .map(
      (item, index) => `<li class="flex flex-wrap items-center gap-6 border-b border-border p-6">
  ${frame("aspect-video w-56 shrink-0")}
  <div class="min-w-0 flex-1">
    <p class="font-mono text-sm text-muted-foreground">${String(index + 1).padStart(2, "0")}</p>
    <h2 class="mt-1 font-heading text-xl">${escapeHtml(item.title)}</h2>
    <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  </div>
</li>`,
    )
    .join("\n");
  return `${nav(copy)}
<main class="mx-auto max-w-5xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <ul class="mt-8 border-t border-border">
${rows}
  </ul>
</main>
${footer(copy)}`;
};

/** 大写し: 1 作品目を全幅の大きな図版で見せ、ほかを下のカードに */
export const showcase: Skeleton = ({ copy }) => {
  const cards = copy.items.map((item, index) => (index === 0 ? heroCard(item) : smallCard(item))).join("\n");
  return `${nav(copy)}
<main class="mx-auto max-w-5xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <div class="mt-8 grid gap-6 md:grid-cols-3">
${cards}
  </div>
</main>
${footer(copy)}`;
};
