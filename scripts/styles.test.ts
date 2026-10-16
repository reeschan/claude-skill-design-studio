// styles / theme サブコマンドを CLI の外から確かめる。style-guide は test/fixtures の偽物を使う
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateDirection } from "../core/styles.ts";
import { stripTailwindImport } from "../core/theme-bridge.ts";
import { LAYOUTS, SKELETON_FAMILIES } from "../core/types.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const FAKE_GUIDE = fileURLToPath(new URL("../test/fixtures/fake-style-guide", import.meta.url));

const STYLE_IDS = ["minimal", "wa-modern", "pop", "corporate", "dark-tech", "editorial"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 応答の JSON をオブジェクトの配列として読む
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`JSON が配列ではありません: ${JSON.stringify(value)}`);
  return value.map((x) => {
    if (!isRecord(x)) throw new Error(`配列の要素がオブジェクトではありません: ${JSON.stringify(x)}`);
    return x;
  });
}

// 偽 style-guide を STYLE_GUIDE_DIR に、使うなら FAKE_SG_MODE も足した env を返す
function fakeEnv(env: NodeJS.ProcessEnv, mode?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, STYLE_GUIDE_DIR: FAKE_GUIDE };
  if (mode !== undefined) out.FAKE_SG_MODE = mode;
  return out;
}

// styles の応答からスタイルの配列を取る
function stylesOf(env: NodeJS.ProcessEnv): Record<string, unknown>[] {
  const res = runCli(["styles"], env);
  assert.equal(res.code, 0);
  return records(payload(res.json).styles);
}

void test("styles は 6 件を決まった並びで返す", () => {
  const { env, cleanup } = tempEnv();
  try {
    const styles = stylesOf(env);
    assert.deepEqual(
      styles.map((s) => s.id),
      STYLE_IDS,
    );
    for (const style of styles) {
      assert.ok(isRecord(style.seed), `${String(style.id)} は seed を持つ`);
      assert.ok(isRecord(style.layouts), `${String(style.id)} は layouts を持つ`);
      assert.ok(isRecord(style.copy), `${String(style.id)} は copy を持つ`);
      assert.equal(isRecord(style.seed) ? style.seed.id : undefined, style.id, "seed.id は id と同じ");
    }
  } finally {
    cleanup();
  }
});

void test("layouts が 3 種類だけの方向性は、足りない骨組みの種類を先頭の配置の型で埋める", () => {
  const { env, cleanup } = tempEnv();
  try {
    const style = stylesOf(env)[0];
    assert.ok(style !== undefined, "スタイルがある");
    // 今の data/styles.json の形 (lp・dashboard・blog の 3 種類だけ)
    const raw = { ...style, layouts: { lp: "split", dashboard: "cards", blog: "magazine" } };
    const direction = validateDirection(raw);
    assert.deepEqual(Object.keys(direction.layouts).sort(), [...SKELETON_FAMILIES].sort());
    assert.equal(direction.layouts.lp, "split");
    assert.equal(direction.layouts.dashboard, "cards");
    assert.equal(direction.layouts.blog, "magazine");
    for (const family of ["pricing", "product", "portfolio", "settings"] as const) {
      assert.equal(direction.layouts[family], LAYOUTS[family][0], family);
    }
  } finally {
    cleanup();
  }
});

void test("theme --direction は layouts のキーがあって値が null なら終了コード 1 (無いキーだけ埋める)", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const style = stylesOf(env)[0];
    assert.ok(style !== undefined, "スタイルがある");
    const layouts = isRecord(style.layouts) ? style.layouts : {};
    for (const family of SKELETON_FAMILIES) {
      const file = join(dir, "null-layouts.json");
      writeFileSync(file, JSON.stringify({ ...style, layouts: { ...layouts, [family]: null } }), "utf8");
      const res = runCli(["theme", "--direction", file], fakeEnv(env));
      assert.equal(res.code, 1, `${family} が null`);
      assert.equal(payload(res.json).error, "input", `${family} が null`);
    }
  } finally {
    cleanup();
  }
});

void test("theme --style は偽 style-guide で終了コード 0、cssForPage に @import を含まない", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["theme", "--style", "minimal"], fakeEnv(env));
    assert.equal(res.code, 0);
    const json = payload(res.json);
    assert.equal(json.themeId, "minimal");
    assert.ok(String(json.css).startsWith('@import "tailwindcss";'), "css は tailwind の import から始まる");
    assert.ok(!String(json.cssForPage).includes("@import"), "cssForPage は @import を含まない");
    assert.equal(json.fontsUrl, "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap");
    assert.deepEqual(json.checks, { light: { pass: 4, total: 5, adjusted: 1 }, dark: { pass: 3, total: 5, adjusted: 0 } });
    assert.equal(json.failed, 2, "failed は style-guide の値がそのまま通る");
  } finally {
    cleanup();
  }
});

void test("theme --direction は検証した種で終了コード 0", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const style = stylesOf(env).find((s) => s.id === "wa-modern");
    assert.ok(style !== undefined, "wa-modern がある");
    const file = join(dir, "direction.json");
    writeFileSync(file, JSON.stringify(style), "utf8");
    const res = runCli(["theme", "--direction", file], fakeEnv(env));
    assert.equal(res.code, 0);
    const json = payload(res.json);
    assert.equal(json.themeId, "wa-modern");
    assert.ok(!String(json.cssForPage).includes("@import"));
  } finally {
    cleanup();
  }
});

void test("theme --direction は壊れた JSON で終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = join(dir, "broken.json");
    writeFileSync(file, "{ not json", "utf8");
    const res = runCli(["theme", "--direction", file], fakeEnv(env));
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "file");
  } finally {
    cleanup();
  }
});

void test("theme --direction は layouts の値が範囲外なら終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const style = stylesOf(env)[0];
    assert.ok(style !== undefined, "スタイルがある");
    const layouts = isRecord(style.layouts) ? style.layouts : {};
    const file = join(dir, "bad-layouts.json");
    writeFileSync(file, JSON.stringify({ ...style, layouts: { ...layouts, lp: "nope" } }), "utf8");
    const res = runCli(["theme", "--direction", file], fakeEnv(env));
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "input");
  } finally {
    cleanup();
  }
});

void test("theme --direction は種が style-guide の制約に違反すると終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const style = stylesOf(env)[0];
    assert.ok(style !== undefined, "スタイルがある");
    const seed = isRecord(style.seed) ? style.seed : {};
    const color = isRecord(seed.color) ? seed.color : {};
    const shape = isRecord(seed.shape) ? seed.shape : {};
    const cases: { label: string; seed: Record<string, unknown> }[] = [
      { label: "brandHue が 360 以上", seed: { ...seed, color: { ...color, brandHue: 400 } } },
      { label: "seed.id が形に合わない", seed: { ...seed, id: "Minimal Theme" } },
      { label: "radiusPx が 48 より大きい", seed: { ...seed, shape: { ...shape, radiusPx: 100 } } },
      { label: "spacingScale が 2 より大きい", seed: { ...seed, shape: { ...shape, spacingScale: 3 } } },
    ];
    for (const { label, seed: bad } of cases) {
      const file = join(dir, "bad-seed.json");
      writeFileSync(file, JSON.stringify({ ...style, seed: bad }), "utf8");
      const res = runCli(["theme", "--direction", file], fakeEnv(env));
      assert.equal(res.code, 1, label);
      assert.equal(payload(res.json).error, "input", label);
    }
  } finally {
    cleanup();
  }
});

void test("古い style-guide は終了コード 2 の style-guide-outdated", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["theme", "--style", "minimal"], fakeEnv(env, "outdated"));
    assert.equal(res.code, 2);
    assert.equal(payload(res.json).error, "style-guide-outdated");
  } finally {
    cleanup();
  }
});

void test("style-guide の失敗は終了コード 3 の style-guide-failed", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["theme", "--style", "minimal"], fakeEnv(env, "fail"));
    assert.equal(res.code, 3);
    assert.equal(payload(res.json).error, "style-guide-failed");
  } finally {
    cleanup();
  }
});

void test("style-guide が無ければ終了コード 2 の style-guide-missing", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const res = runCli(["theme", "--style", "minimal"], { ...env, STYLE_GUIDE_DIR: join(dir, "no-such-style-guide") });
    assert.equal(res.code, 2);
    assert.equal(payload(res.json).error, "style-guide-missing");
  } finally {
    cleanup();
  }
});

void test("theme は --style と --direction のどちらか 1 つだけ", () => {
  const { env, cleanup } = tempEnv();
  try {
    const none = runCli(["theme"], fakeEnv(env));
    assert.equal(none.code, 1);
    assert.equal(payload(none.json).error, "usage");
    const both = runCli(["theme", "--style", "minimal", "--direction", "x.json"], fakeEnv(env));
    assert.equal(both.code, 1);
    assert.equal(payload(both.json).error, "usage");
    const unknown = runCli(["theme", "--style", "nope"], fakeEnv(env));
    assert.equal(unknown.code, 1);
    assert.equal(payload(unknown.json).error, "usage");
  } finally {
    cleanup();
  }
});

void test("stripTailwindImport は先頭の tailwind の import だけを除く", () => {
  assert.equal(stripTailwindImport('@import "tailwindcss";\n.a { color: red; }\n'), ".a { color: red; }\n");
  assert.equal(stripTailwindImport(".a {}\n"), ".a {}\n");
  assert.equal(stripTailwindImport('/* 前書き */\n@import "tailwindcss";\n'), '/* 前書き */\n@import "tailwindcss";\n');
});
