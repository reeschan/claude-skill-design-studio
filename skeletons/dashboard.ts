// ダッシュボードの骨組み (仮)。見出しと配置の型の名前だけを出す。PBI-006 が本実装に置き換える
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
  <div class="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">${escapeHtml(copy.brand)}</div>
</footer>`;
}

// 仮の body。copy.headline と配置の型の名前だけ
function provisional(copy: Copy, layout: string): string {
  return `${nav(copy)}
<main class="mx-auto max-w-4xl p-12">
  <p class="font-mono text-sm text-muted-foreground">ダッシュボード / ${escapeHtml(layout)}</p>
  <h1 class="mt-4 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 text-muted-foreground">この配置の骨組みは準備中です。</p>
</main>
${footer(copy)}`;
}

export const sidebar: Skeleton = ({ copy }) => provisional(copy, "sidebar");
export const topnav: Skeleton = ({ copy }) => provisional(copy, "topnav");
export const cards: Skeleton = ({ copy }) => provisional(copy, "cards");
