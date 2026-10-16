// ダッシュボードの骨組み 3 種 (sidebar・topnav・cards) を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { findDisallowedUrls } from "../core/page-html.ts";
import { LAYOUTS } from "../core/types.ts";
import type { BaseMode, Copy, Layouts } from "../core/types.ts";
import { SKELETONS, renderSkeleton } from "../skeletons/index.ts";

const COPY: Copy = {
  brand: "かたどり工房",
  tagline: "かたちを、ためす",
  headline: "ためしの見出し",
  lead: "説明のための短い文章です。",
  cta: "はじめる",
  items: [
    { title: "項目その一", body: "一つめの説明です。" },
    { title: "項目その二", body: "二つめの説明です。" },
    { title: "項目その三", body: "三つめの説明です。" },
  ],
};

const MODE: BaseMode = "light";
const THEME_ID = "sample-theme";
const TITLE = "ためしのページ";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap";
const CSS_FOR_PAGE = "@theme { --color-primary: oklch(0.5 0.15 260); }";

function render(layout: Layouts["dashboard"]): string {
  return renderSkeleton({
    family: "dashboard",
    layout,
    copy: COPY,
    mode: MODE,
    themeId: THEME_ID,
    cssForPage: CSS_FOR_PAGE,
    fontsUrl: FONTS_URL,
    title: TITLE,
  });
}

void test("ダッシュボードの 3 つは copy.brand・copy.headline・items の題名を含む", () => {
  for (const layout of LAYOUTS.dashboard) {
    const html = render(layout);
    for (const value of [COPY.brand, COPY.headline, ...COPY.items.map((item) => item.title)]) {
      assert.ok(html.includes(value), `dashboard/${layout}: ${value} を含む`);
    }
  }
});

void test("ダッシュボードの 3 つの renderSkeleton は許可外の読み込みも <img も含まない", () => {
  for (const layout of LAYOUTS.dashboard) {
    const html = render(layout);
    assert.deepEqual(findDisallowedUrls(html), [], `dashboard/${layout}: 許可していない読み込み`);
    assert.ok(!html.includes("<img"), `dashboard/${layout}: <img を含まない`);
  }
});

void test("ダッシュボードの 3 つの body は互いに異なる", () => {
  const bodies = LAYOUTS.dashboard.map((layout) => SKELETONS.dashboard[layout]({ copy: COPY, mode: MODE }));
  assert.equal(new Set(bodies).size, 3);
});

void test("sidebar は <aside を含み、topnav は <aside を含まない", () => {
  const sidebar = SKELETONS.dashboard.sidebar({ copy: COPY, mode: MODE });
  const topnav = SKELETONS.dashboard.topnav({ copy: COPY, mode: MODE });
  assert.ok(sidebar.includes("<aside"), "sidebar: <aside を含む");
  assert.ok(!topnav.includes("<aside"), "topnav: <aside を含まない");
});
