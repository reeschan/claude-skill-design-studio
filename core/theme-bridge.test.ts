// テーマの 3 形式への書き出し (Tailwind・JSON・素の CSS 変数) を確かめる。style-guide は test/fixtures の偽物を使う
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { plainCssOf, renderTheme, renderThemeWithDoc, tokensOf } from "./theme-bridge.ts";
import { CliExit, EXIT_ACTION, EXIT_EXTERNAL } from "./cli-exit.ts";
import type { Seed } from "./types.ts";

const FAKE_GUIDE = fileURLToPath(new URL("../test/fixtures/fake-style-guide", import.meta.url));
const NO_GUIDE = fileURLToPath(new URL("../test/fixtures/no-such-style-guide", import.meta.url));

// 偽 style-guide を差し込み、モードを指定する
const fakeEnv = (mode?: string): NodeJS.ProcessEnv => ({
  ...process.env,
  STYLE_GUIDE_DIR: FAKE_GUIDE,
  ...(mode === undefined ? {} : { FAKE_SG_MODE: mode }),
});

const isCliExit =
  (code: number, error: string) =>
  (e: unknown): boolean =>
    e instanceof CliExit && e.code === code && e.payload.error === error;

// 偽 style-guide の応答は種の id と name しか見ないので、最小の形でよい
const SEED: Seed = {
  id: "seed-tokens",
  name: "トークンの種",
  tone: "calm",
  baseMode: "light",
  color: { brandHue: 210, brandChroma: 0.08, accentHue: 20, neutralHue: 210, neutralChroma: 0.01, contrast: 1.2 },
  shape: { radiusPx: 8, spacingScale: 1, shadow: "soft" },
  font: { mood: "humanist", heading: "Inter", body: "Inter", mono: "monospace" },
};

// style-guide の theme.css と同じ形の文字列。先頭に @import、空行、@theme inline の塊、テーマごとの塊
const THEME_CSS =
  '@import "tailwindcss";\n\n@theme inline { --color-primary: var(--primary); }\n[data-theme="x"] { --primary: oklch(0.5 0.1 200); }\n';

void test("plainCssOf は @import と @theme を含まず、:root と値の行とテーマの塊を含む", () => {
  const plain = plainCssOf(THEME_CSS);
  assert.ok(!plain.includes("@import"));
  assert.ok(!plain.includes("@theme"));
  assert.ok(plain.includes(":root { --color-primary: var(--primary); }"));
  assert.ok(plain.includes('[data-theme="x"] { --primary: oklch(0.5 0.1 200); }'));
});

void test("plainCssOf は先頭の空行を落とし、ほかの行はそのままにする", () => {
  assert.equal(plainCssOf(THEME_CSS), ':root { --color-primary: var(--primary); }\n[data-theme="x"] { --primary: oklch(0.5 0.1 200); }\n');
});

void test("plainCssOf は @theme { の塊の開きも :root { に変える", () => {
  const css = '@import "tailwindcss";\n@theme {\n  --radius-md: 16px;\n}\n';
  assert.equal(plainCssOf(css), ":root {\n  --radius-md: 16px;\n}\n");
});

void test("tokensOf は 3 形式の文字列を返す", async () => {
  const tokens = await tokensOf(SEED, { ...process.env, STYLE_GUIDE_DIR: FAKE_GUIDE });
  assert.ok(tokens.tailwind.includes('@import "tailwindcss";'));
  const parsed: unknown = JSON.parse(tokens.json);
  assert.ok(Array.isArray(parsed), `json は配列ではありません: ${tokens.json}`);
  assert.ok(!tokens.css.includes("@import"));
  assert.ok(tokens.css.includes(":root { --fake-radius: 4px; }"));
});

void test("renderThemeWithDoc はテーマとスタイルガイドの文書を返す", async () => {
  const result = await renderThemeWithDoc(SEED, fakeEnv());
  assert.equal(result.styleGuideMd, `# スタイルガイド (偽): ${SEED.name}\n\n- id: ${SEED.id}\n`);
  assert.deepEqual(result.theme, await renderTheme([SEED], fakeEnv()));
});

void test("renderThemeWithDoc は --doc を知らない style-guide で文書を null にし、テーマは取る", async () => {
  const result = await renderThemeWithDoc(SEED, fakeEnv("no-doc"));
  assert.equal(result.styleGuideMd, null);
  assert.equal(typeof result.theme.css, "string");
  assert.ok(result.theme.css.length > 0);
});

void test("renderThemeWithDoc は render を持たない style-guide で style-guide-outdated を投げる", async () => {
  await assert.rejects(renderThemeWithDoc(SEED, fakeEnv("outdated")), isCliExit(EXIT_ACTION, "style-guide-outdated"));
});

void test("renderThemeWithDoc は style-guide の失敗で style-guide-failed を投げる", async () => {
  await assert.rejects(renderThemeWithDoc(SEED, fakeEnv("fail")), isCliExit(EXIT_EXTERNAL, "style-guide-failed"));
});

void test("renderThemeWithDoc は style-guide のフォルダが無いとき style-guide-missing を投げる", async () => {
  await assert.rejects(
    renderThemeWithDoc(SEED, { ...process.env, STYLE_GUIDE_DIR: NO_GUIDE }),
    isCliExit(EXIT_ACTION, "style-guide-missing"),
  );
});
