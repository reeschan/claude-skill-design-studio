// mix と render-direction を CLI の外から確かめる。style-guide は test/fixtures の偽物を使う
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mixDirections, validatePicks } from "../core/direction.ts";
import { loadStyles } from "../core/styles.ts";
import type { MixPicks, Style } from "../core/types.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const FAKE_GUIDE = fileURLToPath(new URL("../test/fixtures/fake-style-guide", import.meta.url));

const STYLES = loadStyles();

// id からスタイルを引く。無ければテストの読み込み時に止める
function styleOf(id: string): Style {
  const found = STYLES.find((style) => style.id === id);
  if (found === undefined) throw new Error(`data/styles.json に ${id} がありません`);
  return found;
}

const MINIMAL = styleOf("minimal");
const WA_MODERN = styleOf("wa-modern");
const POP = styleOf("pop");
const CORPORATE = styleOf("corporate");
const DARK_TECH = styleOf("dark-tech");

// 色 0・フォント 1・形 2・配置 1 の組み合わせ
const PICKS: MixPicks = { color: 0, font: 1, shape: 2, layout: 1 };
const PICKS_ID = "mix-0121";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 応答の 1 項目をオブジェクトとして読む
function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} がオブジェクトではありません: ${JSON.stringify(value)}`);
  return value;
}

// 偽 style-guide を STYLE_GUIDE_DIR に、使うなら FAKE_SG_MODE も足した env を返す
function fakeEnv(env: NodeJS.ProcessEnv, mode?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, STYLE_GUIDE_DIR: FAKE_GUIDE };
  if (mode !== undefined) out.FAKE_SG_MODE = mode;
  return out;
}

// 値を JSON ファイルとして書く
function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

// 応答の direction
function directionOf(json: unknown): Record<string, unknown> {
  return record(payload(json).direction, "direction");
}

void test("validatePicks は 4 軸すべてを見て、mixDirections は決定的な方向性を返す", () => {
  assert.deepEqual(validatePicks({ color: 0, font: 1, shape: 2, layout: 1 }, 3), PICKS);
  for (const bad of [
    { color: 3, font: 1, shape: 2, layout: 1 },
    { color: 0, font: 1, shape: 2 },
    { color: 0, font: 1, shape: 2, layout: -1 },
    { color: 0.5, font: 1, shape: 2, layout: 1 },
  ]) {
    assert.throws(() => validatePicks(bad, 3), JSON.stringify(bad));
  }
  assert.throws(() => validatePicks("nope", 3));

  const first = mixDirections([MINIMAL, WA_MODERN, POP], PICKS);
  const second = mixDirections([MINIMAL, WA_MODERN, POP], PICKS);
  assert.deepEqual(first, second);
  assert.equal(first.id, PICKS_ID);
  assert.equal(first.seed.id, PICKS_ID);
});

void test("mix は色・フォント・形・配置を選んだ案から取り、copy は 0 番を使う", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN, POP]);
    const res = runCli(["mix", "--directions", file, "--picks", JSON.stringify(PICKS)], env);
    assert.equal(res.code, 0, res.stderr);
    const direction = directionOf(res.json);
    const seed = record(direction.seed, "seed");

    assert.equal(direction.id, PICKS_ID);
    assert.equal(seed.id, PICKS_ID);
    assert.equal(direction.name, "ミニマル ベースのミックス");
    assert.equal(seed.name, direction.name);
    assert.deepEqual(seed.color, MINIMAL.seed.color);
    assert.equal(seed.tone, MINIMAL.seed.tone);
    assert.equal(seed.baseMode, MINIMAL.seed.baseMode);
    assert.deepEqual(seed.font, WA_MODERN.seed.font);
    assert.deepEqual(seed.shape, POP.seed.shape);
    assert.deepEqual(direction.layouts, WA_MODERN.layouts);
    assert.deepEqual(direction.copy, MINIMAL.copy);
    assert.equal(direction.rationale, "色は「ミニマル」、フォントは「和モダン」、形は「ポップ」、配置は「和モダン」から取ったミックス。");
    assert.match(String(direction.id), /^[a-z][a-z0-9-]*$/);
    assert.ok(String(direction.id).length <= 20, "id は 20 文字以内");
  } finally {
    cleanup();
  }
});

void test("同じ入力の mix は同じ結果を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN, POP]);
    const args = ["mix", "--directions", file, "--picks", JSON.stringify(PICKS)];
    const first = directionOf(runCli(args, env).json);
    const second = directionOf(runCli(args, env).json);
    assert.deepEqual(second, first);
  } finally {
    cleanup();
  }
});

void test("picks が範囲外・軸が欠けている・directions の件数が外れれば終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const three = writeJson(dir, "three.json", [MINIMAL, WA_MODERN, POP]);
    const zero = writeJson(dir, "zero.json", []);
    const four = writeJson(dir, "four.json", [MINIMAL, WA_MODERN, POP, CORPORATE]);
    const cases: { label: string; file: string; picks: unknown }[] = [
      { label: "範囲外", file: three, picks: { color: 3, font: 1, shape: 2, layout: 1 } },
      { label: "負の値", file: three, picks: { color: -1, font: 1, shape: 2, layout: 1 } },
      { label: "小数", file: three, picks: { color: 1.5, font: 1, shape: 2, layout: 1 } },
      { label: "文字列", file: three, picks: { color: "0", font: 1, shape: 2, layout: 1 } },
      { label: "軸が欠けている", file: three, picks: { color: 0, font: 1, shape: 2 } },
      { label: "directions が 0 件", file: zero, picks: { color: 0, font: 0, shape: 0, layout: 0 } },
      { label: "directions が 4 件", file: four, picks: { color: 0, font: 1, shape: 2, layout: 3 } },
    ];
    for (const c of cases) {
      const res = runCli(["mix", "--directions", c.file, "--picks", JSON.stringify(c.picks)], env);
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, "input", c.label);
    }
  } finally {
    cleanup();
  }
});

void test("mix の引数と入力のファイルの誤りは終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const good = writeJson(dir, "good.json", [MINIMAL, WA_MODERN, POP]);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json", "utf8");
    const notArray = writeJson(dir, "not-array.json", MINIMAL);
    const badDirection = writeJson(dir, "bad-direction.json", [{ ...MINIMAL, layouts: { ...MINIMAL.layouts, lp: "nope" } }]);
    const cases: { label: string; args: string[]; error: string }[] = [
      { label: "引数なし", args: ["mix"], error: "usage" },
      { label: "picks なし", args: ["mix", "--directions", good], error: "usage" },
      { label: "directions なし", args: ["mix", "--picks", "{}"], error: "usage" },
      { label: "知らない引数", args: ["mix", "--directions", good, "--picks", "{}", "--unknown", "x"], error: "usage" },
      { label: "picks が JSON でない", args: ["mix", "--directions", good, "--picks", "{oops"], error: "usage" },
      { label: "directions のファイルが無い", args: ["mix", "--directions", join(dir, "nothing.json"), "--picks", "{}"], error: "file" },
      { label: "directions が壊れている", args: ["mix", "--directions", broken, "--picks", "{}"], error: "file" },
      { label: "directions が配列でない", args: ["mix", "--directions", notArray, "--picks", "{}"], error: "input" },
      { label: "direction の中身が不正", args: ["mix", "--directions", badDirection, "--picks", "{}"], error: "input" },
    ];
    for (const c of cases) {
      const res = runCli(c.args, env);
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, c.error, c.label);
    }
  } finally {
    cleanup();
  }
});

void test("render-direction --style は骨組みを描き、checks と failed を返す", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["render-direction", "--style", "pop", "--page-type", "lp"], fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.themeId, "pop");
    assert.equal(json.pageType, "lp");
    assert.equal(json.layout, "fullbleed");
    assert.equal(json.mode, "light");
    assert.equal(json.file, null);
    assert.deepEqual(json.checks, { light: { pass: 4, total: 5, adjusted: 1 }, dark: { pass: 3, total: 5, adjusted: 0 } });
    assert.equal(json.failed, 2);

    const html = String(json.html);
    assert.ok(html.includes('data-theme="pop"'), "data-theme");
    assert.ok(html.includes('data-mode="light"'), "data-mode");
    assert.ok(html.includes("<title>ポップのLP</title>"), "title");
    assert.ok(html.includes(POP.copy.headline), "pop の copy.headline");
    assert.ok(html.includes(POP.copy.brand), "pop の copy.brand");
  } finally {
    cleanup();
  }
});

void test("--out はファイルに書き、html は null、書いたファイルは check-page で ok", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const args = ["render-direction", "--style", "pop", "--page-type", "lp"];
    const inMemory = String(payload(runCli(args, fakeEnv(env)).json).html);

    const outFile = join(dir, "pop-lp.html");
    const res = runCli([...args, "--out", outFile], fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.html, null);
    assert.equal(json.file, outFile);
    assert.equal(readFileSync(outFile, "utf8"), inMemory, "ファイルの中身は html と同じ");

    const check = payload(runCli(["check-page", "--html", outFile], env).json);
    assert.equal(check.ok, true, JSON.stringify(check.disallowed));
    assert.equal(check.themeId, "pop");
  } finally {
    cleanup();
  }
});

void test("--direction のファイルを描き、--mode が効き、省くと seed.baseMode になる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "dark-tech.json", DARK_TECH);
    const fallback = runCli(["render-direction", "--direction", file, "--page-type", "dashboard"], fakeEnv(env));
    assert.equal(fallback.code, 0, fallback.stderr);
    const dark = payload(fallback.json);
    assert.equal(dark.themeId, "dark-tech");
    assert.equal(dark.layout, "sidebar");
    assert.equal(dark.mode, "dark");
    assert.ok(String(dark.html).includes('data-mode="dark"'));

    const overridden = payload(
      runCli(["render-direction", "--direction", file, "--page-type", "dashboard", "--mode", "light"], fakeEnv(env)).json,
    );
    assert.equal(overridden.mode, "light");
    assert.ok(String(overridden.html).includes('data-mode="light"'));
  } finally {
    cleanup();
  }
});

void test("混ぜた方向性をそのまま骨組みで描ける", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const directions = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN, POP]);
    const mixed = directionOf(runCli(["mix", "--directions", directions, "--picks", JSON.stringify(PICKS)], env).json);
    const file = writeJson(dir, "mixed.json", mixed);
    const res = runCli(["render-direction", "--direction", file, "--page-type", "blog"], fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.themeId, PICKS_ID);
    assert.equal(json.layout, WA_MODERN.layouts.blog);
    assert.ok(String(json.html).includes(`data-theme="${PICKS_ID}"`));
  } finally {
    cleanup();
  }
});

void test("render-direction の引数の誤りは終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const cases: { label: string; args: string[]; error: string }[] = [
      { label: "引数なし", args: ["render-direction"], error: "usage" },
      { label: "page-type なし", args: ["render-direction", "--style", "pop"], error: "usage" },
      { label: "style も direction もなし", args: ["render-direction", "--page-type", "lp"], error: "usage" },
      {
        label: "style と direction の同時指定",
        args: ["render-direction", "--style", "pop", "--direction", "x.json", "--page-type", "lp"],
        error: "usage",
      },
      { label: "知らない style", args: ["render-direction", "--style", "nope", "--page-type", "lp"], error: "usage" },
      { label: "知らない page-type", args: ["render-direction", "--style", "pop", "--page-type", "nope"], error: "input" },
      { label: "知らない mode", args: ["render-direction", "--style", "pop", "--page-type", "lp", "--mode", "sepia"], error: "input" },
      { label: "知らない引数", args: ["render-direction", "--style", "pop", "--page-type", "lp", "--unknown", "x"], error: "usage" },
    ];
    for (const c of cases) {
      const res = runCli(c.args, fakeEnv(env));
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, c.error, c.label);
    }
  } finally {
    cleanup();
  }
});

void test("render-direction も --direction のファイルの誤りで終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json", "utf8");
    const bad = writeJson(dir, "bad.json", { ...MINIMAL, seed: { ...MINIMAL.seed, baseMode: "sepia" } });
    const cases: { label: string; file: string; error: string }[] = [
      { label: "ファイルが無い", file: join(dir, "nothing.json"), error: "file" },
      { label: "JSON が壊れている", file: broken, error: "file" },
      { label: "direction の中身が不正", file: bad, error: "input" },
    ];
    for (const c of cases) {
      const res = runCli(["render-direction", "--direction", c.file, "--page-type", "lp"], fakeEnv(env));
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, c.error, c.label);
    }
  } finally {
    cleanup();
  }
});

void test("style-guide が無ければ render-direction は終了コード 2 の style-guide-missing", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const res = runCli(["render-direction", "--style", "pop", "--page-type", "lp"], {
      ...env,
      STYLE_GUIDE_DIR: join(dir, "no-such-style-guide"),
    });
    assert.equal(res.code, 2);
    assert.equal(payload(res.json).error, "style-guide-missing");
  } finally {
    cleanup();
  }
});
