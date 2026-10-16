// ブログ記事の骨組み 3 種 (skeletons/blog.ts) を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { findDisallowedUrls } from "../core/page-html.ts";
import { LAYOUTS } from "../core/types.ts";
import type { BaseMode, Copy } from "../core/types.ts";
import { SKELETONS, renderSkeleton } from "../skeletons/index.ts";

const COPY: Copy = {
  brand: "しおり舎",
  tagline: "デザインと読みもの",
  headline: "余白がつくる読みやすさ",
  lead: "この記事は、骨組みの違いを見比べるための導入の段落です。",
  cta: "読んでみる",
  items: [
    { title: "見出しのリズム", body: "見出しと段落の間の取り方を確かめる説明です。" },
    { title: "行間と幅", body: "読みやすい幅と行間を確かめる説明です。" },
    { title: "脇欄の役割", body: "目次や著者の欄の置き方を確かめる説明です。" },
  ],
};

const MODE: BaseMode = "light";

// 本番と同じ組み立てで 1 枚のページ HTML を作る
function render(layout: (typeof LAYOUTS.blog)[number]): string {
  return renderSkeleton({
    pageType: "blog",
    layout,
    copy: COPY,
    mode: MODE,
    themeId: "sample-theme",
    cssForPage: "@theme { --color-primary: oklch(0.5 0.15 260); }",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap",
    title: "ブログの記事",
  });
}

void test("3 つの記事の骨組みは題・導入・項目名をすべて含む", () => {
  for (const layout of LAYOUTS.blog) {
    const html = render(layout);
    const label = `blog/${layout}`;
    assert.ok(html.includes(COPY.brand), `${label}: copy.brand`);
    assert.ok(html.includes(COPY.headline), `${label}: copy.headline`);
    assert.ok(html.includes(COPY.lead), `${label}: copy.lead`);
    for (const item of COPY.items) {
      assert.ok(html.includes(item.title), `${label}: ${item.title}`);
    }
  }
});

void test("3 つの body は互いに異なる", () => {
  const bodies = LAYOUTS.blog.map((layout) => SKELETONS.blog[layout]({ copy: COPY, mode: MODE }));
  assert.equal(new Set(bodies).size, 3);
});

void test("3 つの記事は許可していない読み込みも <img も含まない", () => {
  for (const layout of LAYOUTS.blog) {
    const html = render(layout);
    const label = `blog/${layout}`;
    assert.deepEqual(findDisallowedUrls(html), [], label);
    assert.ok(!html.includes("<img"), `${label}: <img を含まない`);
  }
});

void test("3 つの記事はどれも <article を含む", () => {
  for (const layout of LAYOUTS.blog) {
    assert.ok(render(layout).includes("<article"), `blog/${layout}`);
  }
});
