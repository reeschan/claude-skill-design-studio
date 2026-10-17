// 設定画面の骨組み 3 種 (左ナビ・タブ・積み上げ)。完成品ではなく、配置の違いを見せるためのもの
// 入力の欄は input・select・トグル風の見た目だけを置き、<form> は置かない (CSP が form-action 'none' のため)
import { escapeHtml } from "../core/page-html.ts";
import type { Copy } from "../core/types.ts";
import type { Skeleton } from "./types.ts";

type CopyItem = Copy["items"][number];

// 上部のバー。ブランド名と、保存のボタン
function topBar(copy: Copy): string {
  return `<header class="border-b border-border bg-card">
  <div class="mx-auto flex max-w-3xl items-center justify-between p-4">
    <span class="font-heading text-lg">${escapeHtml(copy.brand)}</span>
    <button type="button" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</button>
  </div>
</header>`;
}

// 下部のフッター
function footer(copy: Copy): string {
  return `<footer class="border-t border-border bg-muted">
  <div class="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">${escapeHtml(copy.brand)}</div>
</footer>`;
}

// 文字を入れる欄
function textField(label: string, placeholder: string): string {
  return `<label class="block">
  <span class="text-sm text-muted-foreground">${escapeHtml(label)}</span>
  <input type="text" placeholder="${escapeHtml(placeholder)}" class="mt-2 w-full rounded-md border border-border bg-card p-3" />
</label>`;
}

// 選ぶ欄
function selectField(label: string, options: string[]): string {
  const items = options.map((option) => `<option>${escapeHtml(option)}</option>`).join("\n");
  return `<label class="block">
  <span class="text-sm text-muted-foreground">${escapeHtml(label)}</span>
  <select class="mt-2 w-full rounded-md border border-border bg-card p-3">
${items}
  </select>
</label>`;
}

// 切り替えの欄。見た目だけのトグル (動かない)
function toggleField(label: string, on: boolean): string {
  const track = on ? "bg-primary" : "bg-muted";
  const knob = on ? "ml-auto" : "";
  return `<div class="flex items-center justify-between gap-4">
  <span class="text-sm text-muted-foreground">${escapeHtml(label)}</span>
  <span class="flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ${track}" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${escapeHtml(label)}">
    <span class="h-5 w-5 rounded-full bg-card shadow-md ${knob}"></span>
  </span>
</div>`;
}

// 設定の分類 1 つぶんの区画。題・説明と、3 種類の入力の欄
function group(item: CopyItem, index: number): string {
  return `<section id="set-${index + 1}" class="rounded-lg border border-border bg-card p-6 shadow-md">
  <h2 class="font-heading text-xl">${escapeHtml(item.title)}</h2>
  <p class="mt-2 text-sm text-muted-foreground">${escapeHtml(item.body)}</p>
  <div class="mt-6 grid gap-6 md:grid-cols-2">
${textField("表示名", "かたどり工房")}
${selectField("公開の範囲", ["全員に公開", "リンクを知っている人だけ", "自分のみ"])}
  </div>
  <div class="mt-6">
${toggleField("更新をメールで知らせる", true)}
  </div>
</section>`;
}

/** 左ナビ: 左に設定の分類のナビ、右に分類ごとの入力の欄 */
export const sidebar: Skeleton = ({ copy }) => {
  const menu = copy.items
    .map((item, index) => `<a href="#set-${index + 1}" class="rounded-md p-4 text-sm text-muted-foreground">${escapeHtml(item.title)}</a>`)
    .join("\n");
  const groups = copy.items.map((item, index) => group(item, index)).join("\n");
  return `<div class="flex min-h-screen">
  <aside class="w-64 shrink-0 border-r border-border bg-muted p-4">
    <p class="font-heading text-lg">${escapeHtml(copy.brand)}</p>
    <nav class="mt-8 flex flex-col gap-2">
${menu}
    </nav>
  </aside>
  <div class="flex flex-1 flex-col">
    <main class="flex-1 p-8">
      <div class="mx-auto max-w-3xl">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
            <h1 class="mt-1 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
          </div>
          <button type="button" class="rounded-md bg-primary px-4 py-2 text-primary-foreground shadow-md">${escapeHtml(copy.cta)}</button>
        </div>
        <p class="mt-4 max-w-2xl text-muted-foreground">${escapeHtml(copy.lead)}</p>
        <div class="mt-8 flex flex-col gap-6">
${groups}
        </div>
      </div>
    </main>
    ${footer(copy)}
  </div>
</div>`;
};

/** タブ: 上に分類のタブ、下に選んだ分類の入力の欄 */
export const tabs: Skeleton = ({ copy }) => {
  const tabBar = copy.items
    .map(
      (item, index) =>
        `<a href="#" class="rounded-md px-4 py-2 text-sm ${index === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground"}">${escapeHtml(item.title)}</a>`,
    )
    .join("\n");
  const panel = copy.items
    .slice(0, 1)
    .map((item, index) => group(item, index))
    .join("\n");
  return `${topBar(copy)}
<main class="mx-auto max-w-3xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <nav class="mt-8 flex flex-wrap gap-2">
${tabBar}
  </nav>
  <div class="mt-6">
${panel}
  </div>
</main>
${footer(copy)}`;
};

/** 積み上げ: 分類ごとの区画を縦に積む。ナビは置かない */
export const stacked: Skeleton = ({ copy }) => {
  const groups = copy.items.map((item, index) => group(item, index)).join("\n");
  return `${topBar(copy)}
<main class="mx-auto max-w-3xl p-8">
  <p class="text-sm text-muted-foreground">${escapeHtml(copy.tagline)}</p>
  <h1 class="mt-2 font-heading text-3xl">${escapeHtml(copy.headline)}</h1>
  <p class="mt-4 text-muted-foreground">${escapeHtml(copy.lead)}</p>
  <div class="mt-8 flex flex-col gap-6">
${groups}
  </div>
</main>
${footer(copy)}`;
};
