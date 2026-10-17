// ポートフォリオの骨組み 3 種 (skeletons/portfolio.ts の grid・list・showcase) を外から確かめる
// skeletons/index.ts への登録は別の PBI なので、ここでは関数を直接呼び、pageHtml で包んで確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, findDisallowedUrls, pageHtml } from "../core/page-html.ts";
import type { BaseMode, Copy } from "../core/types.ts";
import { grid, list, showcase } from "../skeletons/portfolio.ts";
import type { Skeleton } from "../skeletons/types.ts";

const LAYOUTS = { grid, list, showcase } as const;
const MODES = ["light", "dark"] as const;
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap";

// エスケープを確かめるため、確かめる文章にはすべて `<` を入れる
const COPY: Copy = {
  brand: "ヒバリ<工房>",
  tagline: "かたちの<見本>",
  headline: "<作品>を並べる",
  lead: "<短い>説明の文章です。",
  cta: "<依頼>する",
  items: [
    { title: "<作品A>の題名", body: "ひとつめの<説明>です。" },
    { title: "<作品B>の題名", body: "ふたつめの説明です。" },
    { title: "<作品C>の題名", body: "みっつめの説明です。" },
  ],
};

const TOKENS = [COPY.headline, COPY.cta, ...COPY.items.map((item) => item.title)];

function bodyOf(skeleton: Skeleton, mode: BaseMode): string {
  return skeleton({ copy: COPY, mode });
}

// PBI の指示どおり pageHtml で包む
function pageOf(skeleton: Skeleton, mode: BaseMode): string {
  return pageHtml({ title: "ポートフォリオの見本", themeId: "t", mode, cssForPage: "", fontsUrl: FONTS_URL, body: bodyOf(skeleton, mode) });
}

void test("3 つの骨組みは許可していない読み込みを含まず、<script も <form も含まない", () => {
  for (const [name, skeleton] of Object.entries(LAYOUTS)) {
    const body = bodyOf(skeleton, "light");
    assert.deepEqual(findDisallowedUrls(pageOf(skeleton, "light")), [], `${name}: 許可していない読み込み`);
    assert.ok(!body.includes("<script"), `${name}: <script を含まない`);
    assert.ok(!body.includes("<form"), `${name}: <form を含まない`);
  }
});

void test("3 つの骨組みは題・ボタン・作品名をエスケープして含む", () => {
  for (const [name, skeleton] of Object.entries(LAYOUTS)) {
    const html = pageOf(skeleton, "light");
    for (const token of TOKENS) {
      assert.ok(html.includes(escapeHtml(token)), `${name}: ${token} はエスケープされて入る`);
      assert.ok(!html.includes(token), `${name}: ${token} は生のままでは入らない`);
    }
  }
});

void test("3 つの骨組みの body はたがいに違う", () => {
  const bodies = Object.values(LAYOUTS).map((skeleton) => bodyOf(skeleton, "light"));
  assert.equal(new Set(bodies).size, 3);
});

void test("3 つの骨組みは light と dark の両方で描ける", () => {
  for (const [name, skeleton] of Object.entries(LAYOUTS)) {
    for (const mode of MODES) {
      const html = pageOf(skeleton, mode);
      assert.ok(html.includes(`data-mode="${mode}"`), `${name}/${mode}: 描いたモードが入る`);
      assert.ok(html.includes(bodyOf(skeleton, mode)), `${name}/${mode}: body が組み込まれる`);
      assert.deepEqual(findDisallowedUrls(html), [], `${name}/${mode}: 許可していない読み込み`);
    }
  }
});

void test("grid はカードの格子、list は画像の枠つきの一覧、showcase は先頭を大きく", () => {
  const gridBody = bodyOf(grid, "light");
  const listBody = bodyOf(list, "light");
  const showcaseBody = bodyOf(showcase, "light");
  assert.ok(gridBody.includes("<article"), "grid: <article を含む");
  assert.ok(listBody.includes("<li"), "list: <li を含む");
  assert.ok(!listBody.includes("<article"), "list: <article を含まない");
  assert.ok(showcaseBody.includes("md:col-span-3"), "showcase: 先頭の作品は全幅");
});
