// 骨組み 21 枚 (7 種類 × 3 型) を、本番と同じ組み立て (renderSkeleton) で確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { findDisallowedUrls, hasPageCsp } from "../core/page-html.ts";
import { LAYOUTS, SKELETON_FAMILIES } from "../core/types.ts";
import type { BaseMode, Copy, SkeletonFamily } from "../core/types.ts";
import { renderSkeleton } from "../skeletons/index.ts";

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

const MODES: BaseMode[] = ["light", "dark"];

// 本番と同じ組み立てで 1 枚のページ HTML を作る
function render(family: SkeletonFamily, layout: string, mode: BaseMode): string {
  return renderSkeleton({
    family,
    layout,
    copy: COPY,
    mode,
    themeId: "sample-theme",
    cssForPage: "@theme { --color-primary: oklch(0.5 0.15 260); }",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap",
    title: "骨組みの見本",
  });
}

// data-hero 属性 (値なし) の数を数える
function countDataHero(html: string): number {
  return html.match(/\bdata-hero(?=[\s>])/g)?.length ?? 0;
}

void test("21 枚 (7 種類 × 3 型) が light と dark のどちらでも描ける", () => {
  let count = 0;
  for (const family of SKELETON_FAMILIES) {
    for (const layout of LAYOUTS[family]) {
      for (const mode of MODES) {
        const label = `${family}/${layout}[${mode}]`;
        const html = render(family, layout, mode);
        assert.ok(html.startsWith("<!doctype html>"), `${label}: <!doctype html> で始まる`);
        assert.ok(html.includes(`data-mode="${mode}"`), `${label}: data-mode`);
        assert.ok(html.includes(COPY.headline), `${label}: copy.headline`);
        assert.deepEqual(findDisallowedUrls(html), [], `${label}: 許可していない読み込み`);
        assert.equal(hasPageCsp(html), true, `${label}: CSP の meta`);
        count += 1;
      }
    }
  }
  assert.equal(count, 42, "21 枚 × 2 モード");
});

void test("LP の 3 つの配置の型は、light と dark のどちらでも data-hero をちょうど 1 つ持つ", () => {
  for (const layout of LAYOUTS.lp) {
    for (const mode of MODES) {
      const label = `lp/${layout}[${mode}]`;
      const html = render("lp", layout, mode);
      assert.equal(countDataHero(html), 1, `${label}: data-hero はちょうど 1 つ`);
      assert.match(html, /<section\b[^>]*\sdata-hero(?=[\s>])/, `${label}: ヒーローの <section> に付く`);
    }
  }
});

void test("ダッシュボードの骨組み 3 種には data-hero が無い", () => {
  for (const layout of LAYOUTS.dashboard) {
    for (const mode of MODES) {
      const label = `dashboard/${layout}[${mode}]`;
      assert.equal(countDataHero(render("dashboard", layout, mode)), 0, `${label}: data-hero を含まない`);
    }
  }
});
