// ブログ記事の骨組み 3 種 (読み物の 1 段・雑誌風・最小限)。完成品ではなく、配置の違いを見せるためのもの
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

// 記事の分類と日付の欄。tagline を使う
function meta(copy: Copy): string {
  return `<p class="font-mono text-sm text-muted-foreground">ブログ / ${escapeHtml(copy.tagline)}</p>`;
}

// copy.items を小見出し (h2) と段落の組にし、目次から指せるよう id を振る
function itemSections(copy: Copy, className: string): string {
  return copy.items
    .map(
      (item, index) => `<section id="item-${index + 1}" class="${className}">
  <h2 class="font-heading text-xl">${escapeHtml(item.title)}</h2>
  <p class="mt-2 text-muted-foreground">${escapeHtml(item.body)}</p>
</section>`,
    )
    .join("\n");
}

// 目次。各項目への同じページ内のリンク
function toc(copy: Copy): string {
  const links = copy.items.map((item, index) => `<li><a href="#item-${index + 1}">${escapeHtml(item.title)}</a></li>`).join("\n");
  return `<nav class="rounded-lg border border-border bg-card p-4 shadow-md">
  <p class="font-heading text-sm">目次</p>
  <ol class="mt-2 space-y-2 text-sm text-muted-foreground">
${links}
  </ol>
</nav>`;
}

// 著者の脇欄。ブランド名を執筆者として使う
function author(copy: Copy): string {
  return `<div class="mt-4 rounded-lg border border-border bg-muted p-4">
  <p class="font-heading text-sm">執筆</p>
  <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(copy.brand)} 編集部</p>
</div>`;
}

/** 読み物の 1 段: 読みやすい幅の本文と、右に目次・著者の脇欄 */
export const classic: Skeleton = ({ copy }) => {
  return `${nav(copy)}
<article class="mx-auto max-w-5xl p-8">
  <div class="grid gap-8 md:grid-cols-3">
    <div class="max-w-prose md:col-span-2">
      ${meta(copy)}
      <h1 class="mt-4 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
      <p class="mt-4 text-muted-foreground">${escapeHtml(copy.lead)}</p>
${itemSections(copy, "mt-8")}
    </div>
    <aside>
      ${toc(copy)}
      ${author(copy)}
    </aside>
  </div>
</article>
${footer(copy)}`;
};

/** 雑誌風: 全幅のグラデーションの帯と大きな題、2 段組みの導入、引用の囲み */
export const magazine: Skeleton = ({ copy }) => {
  return `${nav(copy)}
<article>
  <section class="bg-linear-to-br from-primary to-accent p-16 text-primary-foreground">
    <div class="mx-auto max-w-5xl">
      <p class="font-mono text-sm">${escapeHtml(copy.tagline)}</p>
      <h1 class="mt-6 font-heading text-5xl">${escapeHtml(copy.headline)}</h1>
    </div>
  </section>
  <div class="mx-auto max-w-5xl p-8">
    <p class="columns-2 gap-8 text-lg text-muted-foreground">${escapeHtml(copy.lead)}</p>
    <blockquote class="mt-8 border-l-4 border-border bg-muted p-6">
      <p class="font-heading text-2xl">「読みやすさは、余白から生まれる。」</p>
      <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(copy.brand)} 編集部</p>
    </blockquote>
${itemSections(copy, "mt-8")}
  </div>
</article>
${footer(copy)}`;
};

/** 最小限: 装飾をほぼ無くした 1 段。題・日付・本文だけで、余白を広く */
export const minimal: Skeleton = ({ copy }) => {
  return `${nav(copy)}
<article class="mx-auto max-w-prose p-16">
  ${meta(copy)}
  <h1 class="mt-6 font-heading text-4xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-8 text-muted-foreground">${escapeHtml(copy.lead)}</p>
${itemSections(copy, "mt-12")}
</article>
${footer(copy)}`;
};
