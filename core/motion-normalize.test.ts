// ゆるい言い方を entry にする。Jev はモックだけで、本物の API は呼ばない
import assert from "node:assert/strict";
import { test } from "node:test";
import { motionDesignMarkdown } from "./motion-design.ts";
import { loadMotionDictionary } from "./motion-dictionary.ts";
import { validateMotionEntry } from "./motion-entry.ts";
import { normalizeMotion } from "./motion-normalize.ts";
import type { NormalizeOk, NormalizeResult } from "./motion-normalize.ts";
import { loadMotions } from "./treatment.ts";
import type { MotionEntry } from "./types.ts";

function okOf(result: NormalizeResult): NormalizeOk {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("正規化に失敗しました");
  return result;
}

function entry(result: NormalizeResult, index = 0): MotionEntry {
  const entries = okOf(result).entries;
  const found = entries[index];
  assert.ok(found !== undefined);
  return found;
}

void test("辞書はきっかけ 5 件と効果 38 件で、既存の見本も残る", () => {
  const dict = loadMotionDictionary();
  assert.equal(dict.triggers.length, 5);
  assert.equal(dict.effects.length, 38);
  const motions = loadMotions();
  assert.equal(motions.length, 12 + 36);
  assert.equal(motions[0]?.id, "spinning-border");
  assert.ok(motions.some((motion) => motion.id === "aurora"));
  assert.ok(motions.some((motion) => motion.id === "fade-up"));
  assert.equal(motions.filter((motion) => motion.id === "stagger").length, 1);
  const stagger = motions.find((motion) => motion.id === "stagger");
  assert.ok(stagger?.css.includes("sibling-index"));
  assert.ok(stagger?.aliases.includes("順番に"));
});

void test("ヒーローの背景だけゆっくり、は parallax の 1 件になる", async () => {
  const result = await normalizeMotion({ section: "hero", phrase: "ヒーローの背景だけゆっくり動かしたい" }, {});
  const hero = entry(result);
  assert.equal(hero.section, "hero");
  assert.equal(hero.target, "bg");
  assert.deepEqual(hero.effect, ["parallax"]);
  assert.equal(hero.trigger, "scroll-linked");
  assert.equal(hero.impl, "css-sda");
  assert.equal(hero.css_only, true);
  assert.equal(hero.reduced_motion, "static");
  assert.equal(validateMotionEntry(hero).length, 0);
  assert.equal(okOf(result).source, "alias");
});

void test("きっかけと対象が違う言い方は entry を分ける", async () => {
  const result = okOf(await normalizeMotion({ section: "hero", phrase: "背景はゆっくり、見出しは下からふわっと" }, {}));
  const entries = result.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.target, "bg");
  assert.deepEqual(entries[0]?.effect, ["parallax"]);
  assert.equal(entries[1]?.target, "heading");
  assert.deepEqual(entries[1]?.effect, ["fade-up"]);
  assert.equal(entries[1]?.trigger, "on-enter");
  assert.equal(entries[1]?.impl, "css");
  assert.ok(result.notes.some((note) => note.includes("分けました")));
});

void test("相性の悪いきっかけは日本語のエラーになる", async () => {
  const result = await normalizeMotion({ section: "features", phrase: "スクロール連動でカードが上に重なる" }, {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("組み合わせられません")));
});

void test("辞書に無い言い方と、見本だけの名前を区別する", async () => {
  const missing = await normalizeMotion({ section: "hero", phrase: "わけのわからない動き" }, {});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.ok(missing.errors[0]?.includes("辞書の別名"));
  const aurora = await normalizeMotion({ section: "hero", phrase: "オーロラ" }, {});
  assert.equal(aurora.ok, false);
  if (!aurora.ok) assert.ok(aurora.errors[0]?.includes("aurora"));
});

void test("Jev の採点で同じ entry の効果の順が変わる。失敗しても別名のまま", async () => {
  const phrase = "順番に、下からふわっと";
  const alias = await normalizeMotion({ section: "features", phrase }, {});
  assert.deepEqual(entry(alias).effect, ["stagger", "fade-up"]);
  const jev = okOf(
    await normalizeMotion({ section: "features", phrase }, { DESIGN_STUDIO_JEV_MOCK: JSON.stringify({ "fade-up": 2.8, stagger: 0.4 }) }),
  );
  assert.equal(jev.source, "jev");
  assert.deepEqual(entry(jev).effect, ["fade-up", "stagger"]);
  const failed = okOf(await normalizeMotion({ section: "features", phrase }, { DESIGN_STUDIO_JEV_MOCK: "fail" }));
  assert.equal(failed.source, "alias");
  assert.deepEqual(entry(failed).effect, ["stagger", "fade-up"]);
  assert.ok(failed.notes.some((note) => note.includes("Jev")));
});

void test("Motion 節に reason と reduced_motion が出る", async () => {
  const result = await normalizeMotion(
    { section: "hero", target: "bg", phrase: "背景だけゆっくり", reason: "背景だけゆっくり動かしたい" },
    {},
  );
  const markdown = motionDesignMarkdown([entry(result)]);
  assert.ok(markdown.startsWith("## Motion"));
  assert.ok(markdown.includes("背景だけゆっくり動かしたい"));
  assert.ok(markdown.includes('"reduced_motion": "static"'));
  assert.ok(markdown.includes("`parallax`"));
  assert.ok(markdown.includes("/impeccable animate"));
});

void test("足した見本の CSS は色を直書きせず、reduced-motion を持つ", () => {
  const forbidden = ["rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "lab(", "url(", "</style"];
  for (const motion of loadMotions()) {
    const css = motion.css.toLowerCase();
    assert.ok(css.includes("prefers-reduced-motion"), motion.id);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(motion.css), motion.id);
    for (const token of forbidden) assert.ok(!css.includes(token), `${motion.id} ${token}`);
    assert.ok(!motion.html.toLowerCase().includes("<script"), motion.id);
    if (motion.support === "fallback") assert.ok(motion.css.includes("@supports"), motion.id);
  }
});

void test("bounce のイージングは通さない", () => {
  const errors = validateMotionEntry({
    section: "hero",
    trigger: "on-enter",
    effect: ["fade-up"],
    impl: "css",
    css_only: true,
    reason: "見出しを出したい",
    reduced_motion: "opacity-only",
    easing: "bounce",
  });
  assert.ok(errors.some((error) => error.includes("bounce")));
});
