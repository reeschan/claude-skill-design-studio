// 背景スケッチの入力の検証・テーマの色・焼き込んだ画像のページへの差し込みを確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import {
  BACKGROUND_IMAGE_MAX,
  BACKGROUND_STYLE_ID,
  SKETCH_CODE_MAX,
  applyBackground,
  sketchPaletteOf,
  validateBackgroundApply,
  validateBackgroundSketch,
} from "./background.ts";
import { checkMotion, findDisallowedUrls, hasPageCsp, pageHtml } from "./page-html.ts";
import type { BackgroundApply, BackgroundSketch, SketchPalette } from "./types.ts";

// 受け付ける画像の data URL (中身は base64 の文字だけ)
const IMAGE_1 = `data:image/webp;base64,${"A".repeat(64)}`;
const IMAGE_2 = `data:image/webp;base64,${"B".repeat(64)}`;

const THEME_CSS = [
  "@theme inline { --color-background: var(--background); }",
  '[data-theme="t"] { --background: oklch(0.160 0.050 250.0); --primary: oklch(0.700 0.133 225.0); --brand-accent: oklch(0.720 0.106 55.0); }',
  '[data-theme="t"][data-mode="light"] { --background: oklch(0.985 0.007 250.0); --primary: oklch(0.550 0.105 225.0); --brand-accent: oklch(0.600 0.112 55.0); }',
].join("\n");

const isInputError = (error: unknown): boolean => error instanceof CliExit && error.code === EXIT_INPUT && error.payload.error === "input";

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

// 骨組みと同じ形のページ。body だけを差し替える
const pageOf = (body: string): string =>
  pageHtml({
    title: "背景のテスト",
    themeId: "t",
    mode: "dark",
    cssForPage: ":root { --fake-radius: 4px; }",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
    body,
  });

const HERO_PAGE = pageOf('<main>\n<section data-hero="hero">ヒーロー</section>\n</main>');
const PLAIN_PAGE = pageOf("<main>本文</main>");

const applyOf = (overrides: Partial<BackgroundApply> = {}): BackgroundApply => ({
  image: IMAGE_1,
  placement: "hero",
  motion: "slow",
  ...overrides,
});

const sketchOf = (overrides: Partial<BackgroundSketch> = {}): BackgroundSketch => ({
  source: "sample",
  sampleId: "waves",
  code: "draw();",
  placement: "hero",
  motion: "still",
  ...overrides,
});

void test("sketchPaletteOf はモードごとのブロックから sRGB の整数 3 つを取り出す", () => {
  const dark: SketchPalette = sketchPaletteOf(THEME_CSS, "dark");
  assert.deepEqual(dark, { background: [0, 14, 33], primary: [0, 175, 220], accent: [216, 146, 98] });
  const light: SketchPalette = sketchPaletteOf(THEME_CSS, "light");
  assert.deepEqual(light, { background: [247, 251, 255], primary: [0, 126, 159], accent: [179, 108, 57] });
  for (const palette of [dark, light]) {
    for (const rgb of Object.values(palette)) {
      assert.equal(rgb.length, 3);
      for (const value of rgb) assert.ok(Number.isInteger(value) && value >= 0 && value <= 255, `${value} は 0〜255 の整数`);
    }
  }
});

void test("sketchPaletteOf は白黒の端を丸め、ブランドアクセントが無ければ primary を使う", () => {
  assert.deepEqual(sketchPaletteOf('[data-theme="t"] { --background: oklch(1 0 0); }', "dark"), {
    background: [255, 255, 255],
    primary: [128, 128, 128],
    accent: [128, 128, 128],
  });
  assert.deepEqual(sketchPaletteOf('[data-theme="t"] { --background: oklch(0 0 0); --primary: oklch(1 0 0); }', "dark"), {
    background: [0, 0, 0],
    primary: [255, 255, 255],
    accent: [255, 255, 255],
  });
  // 明度は 0.5 でも 50% でも同じ
  assert.deepEqual(
    sketchPaletteOf('[data-theme="t"] { --background: oklch(50% 0 0); }', "dark"),
    sketchPaletteOf('[data-theme="t"] { --background: oklch(0.5 0 0); }', "dark"),
  );
});

void test("sketchPaletteOf は色が無い css では既定の 3 色にする", () => {
  assert.deepEqual(sketchPaletteOf(":root { --fake-radius: 4px; }", "dark"), {
    background: [0, 0, 0],
    primary: [128, 128, 128],
    accent: [255, 255, 255],
  });
  assert.deepEqual(sketchPaletteOf("", "light"), { background: [0, 0, 0], primary: [128, 128, 128], accent: [255, 255, 255] });
});

void test("applyBackground は CSP の meta の直後・title より前に style を差し込み、ページの確かめを通す", () => {
  const result = applyBackground(HERO_PAGE, applyOf({ motion: "still" }));
  assert.equal(hasPageCsp(result), true);
  assert.deepEqual(findDisallowedUrls(result), []);
  assert.equal(checkMotion(result).ok, true);
  const csp = result.indexOf("Content-Security-Policy");
  const style = result.indexOf(`<style id="${BACKGROUND_STYLE_ID}">`);
  const title = result.indexOf("<title>");
  assert.ok(csp !== -1 && style > csp && style < title, "style は CSP の meta より後、title より前");
  assert.ok(result.includes("[data-hero]{position:relative;isolation:isolate}"));
  assert.ok(
    result.includes(
      '[data-hero]::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(color-mix(in oklch,var(--background) 40%,transparent),color-mix(in oklch,var(--background) 40%,transparent)),',
    ),
  );
  assert.ok(result.includes(`url("${IMAGE_1}")`));
});

void test("applyBackground は hero の目印が無いページと placement が page のときに body へ fixed で当てる", () => {
  const noHero = applyBackground(PLAIN_PAGE, applyOf({ placement: "hero" }));
  assert.ok(noHero.includes("body{position:relative;isolation:isolate}"));
  assert.ok(noHero.includes('body::before{content:"";position:fixed;'));
  assert.ok(!noHero.includes("[data-hero]{"));

  const pagePlacement = applyBackground(HERO_PAGE, applyOf({ placement: "page" }));
  assert.ok(pagePlacement.includes("body{position:relative;isolation:isolate}"));
  assert.ok(pagePlacement.includes('body::before{content:"";position:fixed;'));
  assert.ok(!pagePlacement.includes("[data-hero]{"));
});

void test("applyBackground は何度呼んでも style を 1 つにし、null で差し込む前の html に戻す", () => {
  const first = applyBackground(HERO_PAGE, applyOf({ image: IMAGE_1, motion: "still" }));
  const second = applyBackground(first, applyOf({ image: IMAGE_2, motion: "still" }));
  assert.equal(countOf(second, `id="${BACKGROUND_STYLE_ID}"`), 1);
  assert.ok(second.includes(IMAGE_2));
  assert.ok(!second.includes(IMAGE_1));
  assert.equal(applyBackground(second, null), HERO_PAGE);
  assert.equal(applyBackground(HERO_PAGE, null), HERO_PAGE);
});

void test("applyBackground は slow のときだけ動かし、reduced-motion の指定を持つ", () => {
  const slow = applyBackground(HERO_PAGE, applyOf({ motion: "slow" }));
  assert.ok(slow.includes("@keyframes background-sketch-drift"));
  assert.ok(slow.includes("prefers-reduced-motion"));
  assert.ok(slow.includes("animation:background-sketch-drift 48s ease-in-out infinite alternate"));
  assert.equal(checkMotion(slow).ok, true);

  const still = applyBackground(HERO_PAGE, applyOf({ motion: "still" }));
  assert.ok(!still.includes("animation"));
  assert.equal(checkMotion(still).ok, true);
});

void test("applyBackground は CSP の meta の無い html を入力の誤りにする", () => {
  assert.throws(() => applyBackground("<html><head><title>x</title></head><body></body></html>", applyOf()), isInputError);
});

void test("validateBackgroundSketch は null と undefined を null にし、正しい値はそのまま返す", () => {
  assert.equal(validateBackgroundSketch(null), null);
  assert.equal(validateBackgroundSketch(undefined), null);
  const sample = sketchOf();
  assert.deepEqual(validateBackgroundSketch(sample), sample);
  const paste = sketchOf({ source: "paste", sampleId: null });
  assert.deepEqual(validateBackgroundSketch(paste), paste);
  const llm = sketchOf({ source: "llm", sampleId: null });
  assert.deepEqual(validateBackgroundSketch(llm), llm);
  const longest = sketchOf({ code: "x".repeat(SKETCH_CODE_MAX) });
  assert.deepEqual(validateBackgroundSketch(longest), longest);
});

void test("validateBackgroundSketch は形の違う値を入力の誤りにする", () => {
  const cases: [string, unknown][] = [
    ["source が sample で sampleId が文字列でない", sketchOf({ sampleId: 1 as unknown as string })],
    ["source が paste で sampleId が null でない", sketchOf({ source: "paste" })],
    ["code が空", sketchOf({ code: "" })],
    ["code が上限を超える", sketchOf({ code: "x".repeat(SKETCH_CODE_MAX + 1) })],
    ["未知の placement", sketchOf({ placement: "center" as unknown as BackgroundSketch["placement"] })],
    ["未知の motion", sketchOf({ motion: "fast" as unknown as BackgroundSketch["motion"] })],
    ["未知の source", sketchOf({ source: "manual" as unknown as BackgroundSketch["source"] })],
    ["オブジェクトでない", "sketch"],
  ];
  for (const [label, value] of cases) assert.throws(() => validateBackgroundSketch(value), isInputError, label);
});

void test("validateBackgroundApply は正しい値をそのまま返す", () => {
  const apply = applyOf({ placement: "page", motion: "still" });
  assert.deepEqual(validateBackgroundApply(apply), apply);
  assert.equal(BACKGROUND_IMAGE_MAX, 600 * 1024);
});

void test("validateBackgroundApply は画像と placement・motion の誤りを入力の誤りにする", () => {
  const longImage = `data:image/webp;base64,${"A".repeat(BACKGROUND_IMAGE_MAX)}`;
  const cases: [string, unknown][] = [
    ["webp でない data URL", applyOf({ image: "data:image/png;base64,AAAA" })],
    ["base64 でない文字", applyOf({ image: "data:image/webp;base64,!!!!" })],
    ["長さが上限を超える", applyOf({ image: longImage })],
    ["未知の placement", applyOf({ placement: "center" as unknown as BackgroundApply["placement"] })],
    ["未知の motion", applyOf({ motion: "fast" as unknown as BackgroundApply["motion"] })],
    ["画像が文字列でない", { ...applyOf(), image: 1 }],
    ["オブジェクトでない", null],
  ];
  for (const [label, value] of cases) assert.throws(() => validateBackgroundApply(value), isInputError, label);
});
