// 料金の骨組み 3 種 (skeletons/pricing.ts) を外から確かめる。skeletons/index.ts は経由せず、この PBI の関数を直接呼ぶ
import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, findDisallowedUrls, pageHtml } from "../core/page-html.ts";
import type { BaseMode, Copy } from "../core/types.ts";
import { spotlight, table, tiers } from "../skeletons/pricing.ts";

// < を含む copy。エスケープされて入ることを確かめる
const COPY: Copy = {
  brand: "<しおり舎>",
  tagline: "料金の設計",
  headline: "三人の<料金>プラン",
  lead: "骨組みの配置の違いを見比べるための導入の段落です。",
  cta: "無料で<始める>",
  items: [
    { title: "開始の<プラン>", body: "個人で使う小さなプランの説明です。" },
    { title: "標準の<プラン>", body: "少人数のチームで使うプランの説明です。" },
    { title: "拡張の<プラン>", body: "編集部まるごとの大きなプランの説明です。" },
  ],
};

const MODES: BaseMode[] = ["light", "dark"];

const SKELETONS = { tiers, table, spotlight };
const NAMES = Object.keys(SKELETONS) as (keyof typeof SKELETONS)[];

// 本番と同じ組み立てで 1 枚のページ HTML を作る
function page(name: keyof typeof SKELETONS, mode: BaseMode): string {
  return pageHtml({
    title: "料金の見本",
    themeId: "t",
    mode,
    cssForPage: "",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap",
    body: SKELETONS[name]({ copy: COPY, mode }),
  });
}

// 確かめる copy の文面。生のままの値と、エスケープ済みの組
function texts(): { raw: string; escaped: string }[] {
  return [COPY.headline, COPY.cta, ...COPY.items.map((item) => item.title)].map((raw) => ({
    raw,
    escaped: escapeHtml(raw),
  }));
}

void test("3 つの料金の骨組みは題・申込・プラン名をエスケープして含む", () => {
  for (const name of NAMES) {
    const html = page(name, "light");
    const label = `pricing/${name}`;
    for (const text of texts()) {
      assert.ok(html.includes(text.escaped), `${label}: ${text.escaped}`);
      assert.ok(!html.includes(text.raw), `${label}: 生の ${text.raw} を含む`);
    }
  }
});

void test("3 つの料金の骨組みは許可していない読み込みを含まない", () => {
  for (const name of NAMES) {
    for (const mode of MODES) {
      const html = page(name, mode);
      assert.deepEqual(findDisallowedUrls(html), [], `pricing/${name}[${mode}]`);
    }
  }
});

void test("3 つの料金の骨組みの body は <script を含まない", () => {
  // pageHtml は必ず script を 1 つ差し込むので、包む前の body だけを見る
  for (const name of NAMES) {
    const body = SKELETONS[name]({ copy: COPY, mode: "light" });
    assert.ok(!body.includes("<script"), `pricing/${name}`);
  }
});

void test("同じ種類の 3 枚の body はたがいに異なる", () => {
  const bodies = Object.values(SKELETONS).map((build) => build({ copy: COPY, mode: "light" }));
  assert.equal(new Set(bodies).size, 3);
});

void test("light と dark のどちらでも描ける", () => {
  for (const name of NAMES) {
    for (const mode of MODES) {
      const html = page(name, mode);
      assert.ok(html.includes(escapeHtml(COPY.headline)), `pricing/${name}[${mode}]`);
    }
  }
});
