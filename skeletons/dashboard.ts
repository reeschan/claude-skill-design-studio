// ダッシュボードの骨組み 3 種 (左ナビ・上部ナビ・カード)。完成品ではなく、配置の違いを見せるためのもの
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

// 架空の KPI。数値は見た目のためのもの
const KPIS = [
  { label: "月間の訪問", value: "12,480", note: "前月比 +12%" },
  { label: "登録者", value: "3,206", note: "前月比 +8%" },
  { label: "売上", value: "1,284,000", note: "前月比 +5%" },
  { label: "継続率", value: "92.4%", note: "前月比 +1.2pt" },
];
// 棒グラフの高さ (0〜100 の割合)。見た目のための値
const BAR_HEIGHTS = [42, 66, 54, 78, 62, 88, 70, 58, 82, 94, 76, 86];
// 折れ線グラフの値 (0〜100 の割合)。見た目のための値
const LINE_VALUES = [34, 52, 44, 66, 60, 82, 74, 90, 96];

type Kpi = (typeof KPIS)[number];
type CopyItem = Copy["items"][number];

// 上部のナビ。ブランド名と 2 つのリンクとボタン
function nav(copy: Copy): string {
  return `<header class="border-b border-border">
  <nav class="mx-auto flex max-w-5xl items-center justify-between p-4">
    <span class="font-heading text-lg">${escapeHtml(copy.brand)}</span>
    <div class="flex items-center gap-6 text-sm text-muted-foreground">
      <a href="#">概況</a>
      <a href="#">項目</a>
      <a href="#" class="rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
    </div>
  </nav>
</header>`;
}

// 簡素な上部のナビ。ブランド名とボタンだけ (カードの配置用)
function simpleNav(copy: Copy): string {
  return `<header class="border-b border-border bg-card">
  <nav class="mx-auto flex max-w-5xl items-center justify-between p-4">
    <span class="font-heading text-lg">${escapeHtml(copy.brand)}</span>
    <a href="#" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
  </nav>
</header>`;
}

// 下部のフッター
function footer(copy: Copy): string {
  return `<footer class="border-t border-border bg-muted">
  <div class="mx-auto max-w-5xl p-6 text-sm text-muted-foreground">${escapeHtml(copy.brand)}</div>
</footer>`;
}

// KPI カード 1 枚
function kpiCard(kpi: Kpi): string {
  return `<div class="rounded-lg border border-border bg-card p-4 shadow-md">
  <p class="text-sm text-muted-foreground">${escapeHtml(kpi.label)}</p>
  <p class="mt-2 font-mono text-2xl">${escapeHtml(kpi.value)}</p>
  <p class="mt-1 text-sm text-muted-foreground">${escapeHtml(kpi.note)}</p>
</div>`;
}

// KPI の 4 枚を並べる。列数は呼ぶ側が決める
function kpiRow(columns: string): string {
  const cards = KPIS.map(kpiCard).join("\n");
  return `<div class="mt-8 grid gap-4 ${columns}">
${cards}
</div>`;
}

// 棒グラフ (インライン SVG)。最後の 1 本だけアクセント色
function barChart(): string {
  const bars = BAR_HEIGHTS.map((height, index) => {
    const fill = index === BAR_HEIGHTS.length - 1 ? "fill-accent" : "fill-primary";
    return `<rect x="${index * 20}" y="${100 - height}" width="14" height="${height}" rx="2" class="${fill}" />`;
  }).join("\n");
  return `<svg viewBox="0 0 240 100" class="mt-4 h-40 w-full" role="img" aria-label="月ごとの利用数の棒グラフ">
${bars}
</svg>`;
}

// 折れ線グラフ (インライン SVG)。面はアクセント色を薄く重ねる
function lineChart(): string {
  const last = LINE_VALUES.length - 1;
  const points = LINE_VALUES.map((value, index) => `${Math.round((index * 240) / last)},${100 - value}`).join(" ");
  return `<svg viewBox="0 0 240 100" class="mt-4 h-40 w-full" role="img" aria-label="週ごとの訪問の折れ線グラフ">
  <polyline points="0,100 ${points} 240,100" class="fill-accent opacity-20" />
  <polyline points="${points}" class="fill-none stroke-primary" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;
}

// カード 1 枚。先頭は 2×2 の大カード、2 枚目は横長、残りは普通の大きさ
function card(item: CopyItem, index: number): string {
  const span = index === 0 ? "md:col-span-2 md:row-span-2" : index === 1 ? "md:col-span-2" : "";
  const headingSize = index === 0 ? "text-2xl" : "text-lg";
  return `<article class="rounded-lg border border-border bg-card p-6 shadow-md ${span}">
  <h3 class="font-heading ${headingSize}">${escapeHtml(item.title)}</h3>
  <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
</article>`;
}

/** 左ナビ: 左の縦ナビ (brand と items の題名) と、右の KPI 4 枚・棒グラフ・表 */
export const sidebar: Skeleton = ({ copy }) => {
  const menu = copy.items
    .map((item) => `<a href="#" class="rounded-md p-4 text-sm text-muted-foreground">${escapeHtml(item.title)}</a>`)
    .join("\n");
  const rows = copy.items
    .map(
      (item) => `<tr class="border-b border-border">
  <td class="p-4 font-heading">${escapeHtml(item.title)}</td>
  <td class="p-4 text-sm text-muted-foreground">${escapeHtml(item.body)}</td>
</tr>`,
    )
    .join("\n");
  return `<div class="flex min-h-screen">
  <aside class="w-64 shrink-0 border-r border-border bg-muted p-4">
    <p class="font-heading text-lg">${escapeHtml(copy.brand)}</p>
    <nav class="mt-8 flex flex-col gap-2">
${menu}
    </nav>
    <a href="#" class="mt-8 block rounded-md bg-primary p-4 text-center text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</a>
  </aside>
  <div class="flex flex-1 flex-col">
    <main class="flex-1 p-8">
      <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
      <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
      ${kpiRow("md:grid-cols-2")}
      <div class="mt-8 rounded-lg border border-border bg-card p-6 shadow-md">
        <h2 class="font-heading text-xl">利用の推移</h2>
        ${barChart()}
      </div>
      <div class="mt-8 rounded-lg border border-border bg-card shadow-md">
        <h2 class="p-4 font-heading text-xl">項目</h2>
        <table class="w-full border-t border-border text-left">
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </main>
    ${footer(copy)}
  </div>
</div>`;
};

/** 上部ナビ: 横ナビ・見出しと lead・KPI の横一列・折れ線グラフと items のリストの 2 列 */
export const topnav: Skeleton = ({ copy }) => {
  const list = copy.items
    .map(
      (item, index) => `<li class="flex gap-4 border-b border-border p-4">
  <span class="font-mono text-sm text-muted-foreground">${String(index + 1).padStart(2, "0")}</span>
  <div>
    <h3 class="font-heading">${escapeHtml(item.title)}</h3>
    <p class="mt-1 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  </div>
</li>`,
    )
    .join("\n");
  return `${nav(copy)}
<main class="mx-auto max-w-5xl p-8">
  <h1 class="font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-2 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
  ${kpiRow("md:grid-cols-4")}
  <div class="mt-8 grid gap-8 md:grid-cols-2">
    <div class="rounded-lg border border-border bg-card p-6 shadow-md">
      <h2 class="font-heading text-xl">訪問の推移</h2>
      ${lineChart()}
    </div>
    <div class="rounded-lg border border-border bg-card shadow-md">
      <h2 class="p-4 font-heading text-xl">項目</h2>
      <ul class="border-t border-border">
${list}
      </ul>
    </div>
  </div>
</main>
${footer(copy)}`;
};

/** カード: 簡素な上部ナビと、大きさの違うカードのグリッド (2×2 の大カード 1 枚と小カード数枚) */
export const cards: Skeleton = ({ copy }) => {
  const grid = copy.items.map((item, index) => card(item, index)).join("\n");
  return `${simpleNav(copy)}
<main class="mx-auto max-w-5xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <div class="mt-8 grid gap-4 md:grid-cols-4">
${grid}
  </div>
</main>
${footer(copy)}`;
};
