// mix と render-direction を CLI の外から確かめる。style-guide は test/fixtures の偽物を使う
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CliExit } from "../core/cli-exit.ts";
import { applyFineTune, mixDirections, padWeights, validateFineTune, validatePoints, type MixResult } from "../core/direction.ts";
import { THEME_STYLE_TAG } from "../core/page-html.ts";
import { loadStyles, validateDirection } from "../core/styles.ts";
import { findSurface } from "../core/treatment.ts";
import type { Direction, MixPoints, Style } from "../core/types.ts";
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

// 応答の mixed
function mixedOf(json: unknown): Record<string, unknown> {
  return record(payload(json).mixed, "mixed");
}

// 応答の direction
function directionOf(json: unknown): Record<string, unknown> {
  return record(payload(json).direction, "direction");
}

// base を写して、patch をオブジェクトは結合・それ以外は置き換えで重ねる (検証は呼び出し側で行う)
function patchedOf(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const cur = out[key];
    out[key] = isRecord(cur) && isRecord(value) ? patchedOf(cur, value) : value;
  }
  return out;
}

// base を写して patch を重ねた案を作る (validateDirection を通す)
function tuned(base: Record<string, unknown>, patch: Record<string, unknown>): Direction {
  return validateDirection(patchedOf(base, patch));
}

// 4 軸すべてを同じ点に置いたパッドの位置
function allAt(x: number, y: number): MixPoints {
  return { color: { x, y }, font: { x, y }, shape: { x, y }, layout: { x, y } };
}

const CENTER: MixPoints = allAt(0.5, 0.5);
// 色は A・フォントは B・形は C・配置は A の隅 (案 3 件のときの組み合わせ)
const MIX_POINTS: MixPoints = { color: { x: 0, y: 0 }, font: { x: 1, y: 0 }, shape: { x: 0, y: 1 }, layout: { x: 0, y: 0 } };

void test("padWeights は隅・辺の中点・中央の重みを返し、合計は常に 1", () => {
  assert.deepEqual(padWeights({ x: 0, y: 0 }), [1, 0, 0, 0]);
  assert.deepEqual(padWeights({ x: 1, y: 1 }), [0, 0, 0, 1]);
  assert.deepEqual(padWeights({ x: 0.5, y: 0 }), [0.5, 0.5, 0, 0]);
  assert.deepEqual(padWeights({ x: 0.5, y: 0.5 }), [0.25, 0.25, 0.25, 0.25]);
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    for (const y of [0, 0.25, 0.5, 0.75, 1]) {
      const sum = padWeights({ x, y }).reduce((acc, w) => acc + w, 0);
      assert.ok(Math.abs(sum - 1) <= 1e-12, `(${String(x)}, ${String(y)}) の重みの合計が 1 になりません`);
    }
  }
});

void test("mixDirections は同じ入力に決定的な結果を返し、weights と snapped を持つ", () => {
  const first = mixDirections([MINIMAL, WA_MODERN, POP], MIX_POINTS);
  const second = mixDirections([MINIMAL, WA_MODERN, POP], MIX_POINTS);
  assert.deepEqual(first, second);
  assert.deepEqual(first.weights, {
    color: [1, 0, 0, 0],
    font: [0, 1, 0, 0],
    shape: [0, 0, 1, 0],
    layout: [1, 0, 0, 0],
  });
  assert.deepEqual(first.snapped, { color: 0, font: 1, shape: 2, layout: 0, copy: 0 });
  const result: MixResult = first;
  assert.equal(result.direction.seed.id, result.direction.id);
});

void test("brandHue は円周上の重み付き平均 (350 と 10 → 0)、打ち消しありは重い案に従う", () => {
  const hueA = tuned(MINIMAL, { id: "hue-a", name: "色 A", seed: { color: { brandHue: 350 } } });
  const hueB = tuned(MINIMAL, { id: "hue-b", name: "色 B", seed: { color: { brandHue: 10 } } });
  const mixed = mixDirections([hueA, hueB], allAt(0.5, 0)).direction;
  assert.equal(mixed.seed.color.brandHue, 0);

  // 近い 2 問にはならない例: 0 と 180 はベクトルが打ち消しあるので、一番重い案 (A) の色相になる
  const zeroA = tuned(MINIMAL, { id: "hue-c", name: "色 C", seed: { color: { brandHue: 0 } } });
  const zeroB = tuned(MINIMAL, { id: "hue-d", name: "色 D", seed: { color: { brandHue: 180 } } });
  const fallback = mixDirections([zeroA, zeroB], allAt(0.5, 0)).direction;
  assert.equal(fallback.seed.color.brandHue, 0);
});

void test("中央の点では吸着と copy が同一重みで A を先に使う", () => {
  const mixed = mixDirections([MINIMAL, WA_MODERN, POP, CORPORATE], CENTER);
  assert.deepEqual(mixed.weights, {
    color: [0.25, 0.25, 0.25, 0.25],
    font: [0.25, 0.25, 0.25, 0.25],
    shape: [0.25, 0.25, 0.25, 0.25],
    layout: [0.25, 0.25, 0.25, 0.25],
  });
  assert.deepEqual(mixed.snapped, { color: 0, font: 0, shape: 0, layout: 0, copy: 0 });
  const direction = mixed.direction;
  assert.equal(direction.name, `${MINIMAL.name} ベースのミックス`);
  assert.equal(direction.seed.baseMode, MINIMAL.seed.baseMode);
  assert.equal(direction.seed.tone, MINIMAL.seed.tone);
  assert.deepEqual(direction.seed.font, MINIMAL.seed.font);
  assert.equal(direction.seed.shape.shadow, MINIMAL.seed.shape.shadow);
  assert.deepEqual(direction.layouts, MINIMAL.layouts);
  assert.deepEqual(direction.copy, MINIMAL.copy);
});

void test("平均の値は 4 隅の重みと案の値の組から出す", () => {
  // 中央の点の重みは 4 隅とも 0.25。brandHue 0, 0, 90, 180 の円周平均はベクトル (1, 1) の向き = 45
  const hueOf = (name: string, brandHue: number, brandChroma: number, radiusPx: number): Direction =>
    tuned(MINIMAL, { id: name, name, seed: { color: { brandHue, brandChroma }, shape: { radiusPx } } });
  const mixed = mixDirections(
    [hueOf("色 A", 0, 0.1, 0), hueOf("色 B", 0, 0.14, 4), hueOf("色 C", 90, 0.2, 12), hueOf("色 D", 180, 0.25, 24)],
    CENTER,
  ).direction;
  assert.equal(mixed.seed.color.brandHue, 45);
  assert.equal(mixed.seed.color.brandChroma, 0.1725);
  assert.equal(mixed.seed.shape.radiusPx, 10);
});

void test("案が 2 件のとき、足りない 2 隅を先頭の案で埋めて混ぜる", () => {
  // 足りない隅 (C, D) を先頭の案で埋めるので、中央の平均は先頭の案が 3 隅になる (contract.md の 4 節)
  const mixed = mixDirections([MINIMAL, POP], CENTER).direction;
  assert.equal(mixed.seed.color.brandHue, 268.4);
  assert.equal(mixed.seed.color.brandChroma, 0.09);
  assert.equal(mixed.seed.color.contrast, 3.25);
  assert.equal(mixed.seed.shape.radiusPx, 8);
  assert.equal(mixed.seed.shape.shadow, MINIMAL.seed.shape.shadow);
  assert.deepEqual(mixed.layouts, MINIMAL.layouts);
  assert.deepEqual(mixed.copy, MINIMAL.copy);
});

void test("吸着は軸ごとに一番重い案のもので、snapped の添字が一致する", () => {
  const res = mixDirections([MINIMAL, DARK_TECH, POP, CORPORATE], allAt(1, 0));
  assert.deepEqual(res.snapped, { color: 1, font: 1, shape: 1, layout: 1, copy: 1 });
  assert.equal(res.direction.seed.baseMode, DARK_TECH.seed.baseMode);
  assert.equal(res.direction.seed.tone, DARK_TECH.seed.tone);
  assert.equal(res.direction.name, `${DARK_TECH.name} ベースのミックス`);
  assert.deepEqual(res.direction.seed.font, DARK_TECH.seed.font);
  assert.deepEqual(res.direction.layouts, DARK_TECH.layouts);
  assert.equal(res.direction.seed.shape.shadow, DARK_TECH.seed.shape.shadow);
  assert.deepEqual(res.direction.copy, DARK_TECH.copy);

  // 軸ごとに別々の隅を指すと、それぞれの案の値になる
  const perAxis = mixDirections([MINIMAL, WA_MODERN, POP, CORPORATE], {
    color: { x: 0, y: 0 },
    font: { x: 1, y: 0 },
    shape: { x: 0, y: 1 },
    layout: { x: 1, y: 1 },
  });
  assert.deepEqual(perAxis.snapped, { color: 0, font: 1, shape: 2, layout: 3, copy: 0 });
  assert.deepEqual(perAxis.direction.seed.font, WA_MODERN.seed.font);
  assert.equal(perAxis.direction.seed.shape.shadow, POP.seed.shape.shadow);
  assert.deepEqual(perAxis.direction.layouts, CORPORATE.layouts);
  assert.deepEqual(perAxis.direction.copy, MINIMAL.copy);
});

void test("accentHue は null の案を外して円周平均し、重みが付いた案が null だけなら null", () => {
  const noA = tuned(MINIMAL, { id: "acc-a", name: "アクセント無し A", seed: { color: { accentHue: null } } });
  const at40 = tuned(MINIMAL, { id: "acc-b", name: "アクセント 40", seed: { color: { accentHue: 40 } } });
  const mixed = mixDirections([noA, at40], CENTER).direction;
  assert.equal(mixed.seed.color.accentHue, 40);

  const noB = tuned(MINIMAL, { id: "acc-c", name: "アクセント無し B", seed: { color: { accentHue: null } } });
  const none = mixDirections([noA, noB], CENTER).direction;
  assert.deepEqual(none.seed.color.accentHue, null);

  const at350 = tuned(MINIMAL, { id: "acc-d", name: "アクセント 350", seed: { color: { accentHue: 350 } } });
  const at10 = tuned(MINIMAL, { id: "acc-e", name: "アクセント 10", seed: { color: { accentHue: 10 } } });
  // 色の軸を 2 案のちょうど中間に置くと、accentHue も色の軸の円周平均になる
  assert.equal(mixDirections([at350, at10], { ...CENTER, color: { x: 0.5, y: 0 } }).direction.seed.color.accentHue, 0);
});

void test("copy は 4 軸の重みの合計が一番大きい案から取る", () => {
  // 色とフォントが B を指すと、合計で B が一番重くなる
  const res = mixDirections([MINIMAL, WA_MODERN, POP, CORPORATE], {
    color: { x: 1, y: 0 },
    font: { x: 1, y: 0 },
    shape: { x: 0, y: 1 },
    layout: { x: 0, y: 0 },
  });
  assert.deepEqual(res.snapped, { color: 1, font: 1, shape: 2, layout: 0, copy: 1 });
  assert.deepEqual(res.direction.copy, WA_MODERN.copy);
});

void test("copy は重みの合計が同点のとき先の案から取る (丸め誤差があっても A → B → C → D の順)", () => {
  // 正確な値では B と D の合計が 1.35 で同点。丸め誤差のせいで後ろの案が勝たないことを確かめる
  const tieBD = mixDirections([MINIMAL, WA_MODERN, POP, CORPORATE], {
    color: { x: 0.3, y: 0.4 },
    font: { x: 0.7, y: 0 },
    shape: { x: 0.8, y: 0.75 },
    layout: { x: 0.9, y: 0.7 },
  });
  assert.equal(tieBD.snapped.copy, 1, JSON.stringify(tieBD.weights));
  assert.deepEqual(tieBD.direction.copy, WA_MODERN.copy);

  // 正確な値では A と C の合計が 1.6 で同点。C (添字 2) でなく A (添字 0) のもの
  const tieAC = mixDirections([MINIMAL, WA_MODERN, POP, CORPORATE], {
    color: { x: 0, y: 0.25 },
    font: { x: 0.4, y: 0.9 },
    shape: { x: 0.3, y: 0 },
    layout: { x: 0.1, y: 0.9 },
  });
  assert.equal(tieAC.snapped.copy, 0, JSON.stringify(tieAC.weights));
  assert.deepEqual(tieAC.direction.copy, MINIMAL.copy);
});

void test("同じ点なら同じ id、違う点なら違う id (id は mix- の 16 文字)", () => {
  const first = mixDirections([MINIMAL, WA_MODERN], CENTER);
  const second = mixDirections([MINIMAL, WA_MODERN], CENTER);
  assert.equal(first.direction.id, second.direction.id);
  assert.match(first.direction.id, /^mix-[0-9a-f]{12}$/);
  assert.equal(first.direction.id.length, 16);

  const other = mixDirections([MINIMAL, WA_MODERN], { ...CENTER, color: { x: 0.5, y: 0.25 } });
  assert.notEqual(other.direction.id, first.direction.id);
});

void test("案が 1 件のとき、足りない隅は先頭の案で埋めて混ぜられる", () => {
  const res = mixDirections([MINIMAL], allAt(1, 1));
  assert.deepEqual(res.snapped, { color: 3, font: 3, shape: 3, layout: 3, copy: 3 });
  const direction = res.direction;
  assert.deepEqual(direction.seed.color, MINIMAL.seed.color);
  assert.deepEqual(direction.seed.shape, MINIMAL.seed.shape);
  assert.deepEqual(direction.seed.font, MINIMAL.seed.font);
  assert.deepEqual(direction.layouts, MINIMAL.layouts);
  assert.deepEqual(direction.copy, MINIMAL.copy);
  assert.equal(direction.name, `${MINIMAL.name} ベースのミックス`);

  assert.throws(() => mixDirections([], CENTER));
});

void test("validatePoints は 4 軸の点を検証して小数 3 桁に丸める", () => {
  const points = validatePoints({
    color: { x: 0.12345, y: 0 },
    font: { x: 1, y: 1 },
    shape: { x: 0, y: 0.5 },
    layout: { x: 0.75, y: 0.25 },
  });
  assert.equal(points.color.x, 0.123);
  assert.deepEqual(points.font, { x: 1, y: 1 });

  for (const bad of [
    { color: { x: 1.5, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } },
    { color: { x: -0.1, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } },
    { font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } },
    { color: { x: 0, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0 } },
    { color: { x: 0, y: "0" }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } },
    { color: { x: Infinity, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } },
    { color: { x: 0, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 } },
  ]) {
    assert.throws(() => validatePoints(bad), JSON.stringify(bad));
  }
  assert.throws(() => validatePoints("nope"));
  assert.throws(() => validatePoints(null));
});

void test("applyFineTune は空ならそのまま、上書きすると tune- の別 id になる", () => {
  const base = mixDirections([MINIMAL, WA_MODERN], CENTER).direction;
  assert.strictEqual(applyFineTune(base, {}), base);

  const fineTune = validateFineTune({ radiusPx: 10, brandHue: 100 });
  const tuned1 = applyFineTune(base, fineTune);
  assert.equal(tuned1.seed.shape.radiusPx, 10);
  assert.equal(tuned1.seed.color.brandHue, 100);
  assert.equal(tuned1.seed.color.neutralHue, base.seed.color.neutralHue);
  assert.equal(tuned1.name, base.name);
  assert.match(tuned1.id, /^tune-[0-9a-f]{12}$/);
  assert.equal(tuned1.seed.id, tuned1.id);
  assert.notEqual(tuned1.id, base.id);

  const tuned2 = applyFineTune(base, validateFineTune({ radiusPx: 10, brandHue: 100 }));
  assert.equal(tuned2.id, tuned1.id);
  const tuned3 = applyFineTune(base, validateFineTune({ radiusPx: 10 }));
  assert.notEqual(tuned3.id, tuned1.id);
  assert.equal(applyFineTune(base, validateFineTune({ accentHue: null })).seed.color.accentHue, null);
});

void test("validateFineTune は範囲外・形の誤り・知らないキーを止める", () => {
  assert.deepEqual(validateFineTune({}), {});
  assert.deepEqual(validateFineTune({ accentHue: null }), { accentHue: null });
  for (const bad of [
    { radiusPx: 99 },
    { radiusPx: -1 },
    { brandHue: 360 },
    { brandChroma: 0.5 },
    { contrast: 0.5 },
    { spacingScale: 0.4 },
    { spacingScale: 2.1 },
    { shadow: "gooey" },
    { baseMode: "sepia" },
    { accentHue: 360 },
    { accentHue: "red" },
    { font: { mood: "zen", heading: "A", body: "B", mono: "C" } },
    { font: { mood: "mincho", heading: "A", body: "B" } },
    { layouts: { lp: "nope" } },
    { layouts: { pricing: "nope" } },
    { layouts: { gadget: "tiers" } },
    { copy: { brand: "x" } },
    { nope: 1 },
  ]) {
    assert.throws(() => validateFineTune(bad), JSON.stringify(bad));
  }
  assert.throws(() => validateFineTune("nope"));
});

void test("validateFineTune は Object.prototype の名前のキーを知らないキーとして止める", () => {
  for (const key of ["constructor", "__proto__", "valueOf"]) {
    // JSON.parse で作ると __proto__ も自分のキーになる。どれも入力の誤り (CliExit が投げられる)
    const bad: unknown = JSON.parse(`{"${key}": 1}`);
    assert.throws(
      () => validateFineTune(bad),
      (e: unknown) => e instanceof CliExit,
      `{"${key}": 1}`,
    );
  }
});

void test("mix は点の位置で混ぜ、weights と snapped を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN, POP]);
    const res = runCli(["mix", "--directions", file, "--points", JSON.stringify(MIX_POINTS)], env);
    assert.equal(res.code, 0, res.stderr);
    const body = payload(res.json);
    const direction = directionOf(body);
    const mixed = mixedOf(body);
    const seed = record(direction.seed, "seed");

    assert.match(String(direction.id), /^mix-[0-9a-f]{12}$/);
    assert.equal(seed.id, direction.id);
    assert.equal(direction.name, "ミニマル ベースのミックス");
    assert.deepEqual(seed.color, MINIMAL.seed.color);
    assert.equal(seed.tone, MINIMAL.seed.tone);
    assert.equal(seed.baseMode, MINIMAL.seed.baseMode);
    assert.deepEqual(seed.font, WA_MODERN.seed.font);
    assert.deepEqual(seed.shape, POP.seed.shape);
    assert.deepEqual(direction.layouts, MINIMAL.layouts);
    assert.deepEqual(direction.copy, MINIMAL.copy);
    assert.equal(direction.rationale, "色は「ミニマル」、フォントは「和モダン」、形は「ポップ」、配置は「ミニマル」から取ったミックス。");
    assert.match(String(direction.id), /^[a-z][a-z0-9-]*$/);
    assert.ok(String(direction.id).length <= 20, "id は 20 文字以内");
    assert.deepEqual(mixed, direction);
    assert.deepEqual(body.weights, {
      color: [1, 0, 0, 0],
      font: [0, 1, 0, 0],
      shape: [0, 0, 1, 0],
      layout: [1, 0, 0, 0],
    });
    assert.deepEqual(body.snapped, { color: 0, font: 1, shape: 2, layout: 0, copy: 0 });
  } finally {
    cleanup();
  }
});

void test("mix は --fine-tune で上書きし、mixed は混ぜただけのまま", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN]);
    const base = ["mix", "--directions", file, "--points", JSON.stringify(CENTER)];
    const res = runCli([...base, "--fine-tune", JSON.stringify({ radiusPx: 10, brandHue: 100 })], env);
    assert.equal(res.code, 0, res.stderr);
    const direction = directionOf(res.json);
    const mixed = mixedOf(res.json);
    assert.match(String(mixed.id), /^mix-[0-9a-f]{12}$/);
    assert.match(String(direction.id), /^tune-[0-9a-f]{12}$/);
    assert.equal((record(direction.seed, "seed").shape as Record<string, unknown>).radiusPx, 10);
    assert.equal((record(direction.seed, "seed").color as Record<string, unknown>).brandHue, 100);
    assert.notEqual(direction.id, mixed.id);

    for (const fineTune of [{ radiusPx: 99 }, { nope: 1 }, "{oops"]) {
      const res2 = runCli(
        fineTune === "{oops" ? [...base, "--fine-tune", fineTune] : [...base, "--fine-tune", JSON.stringify(fineTune)],
        env,
      );
      assert.equal(res2.code, 1, JSON.stringify(fineTune));
      assert.equal(payload(res2.json).error, fineTune === "{oops" ? "usage" : "input", JSON.stringify(fineTune));
    }
  } finally {
    cleanup();
  }
});

void test("mix はプロトタイプの名前のキーのある fineTune を入力の誤りで止める", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN]);
    for (const fineTune of ['{"constructor": 1}', '{"__proto__": 1}', '{"valueOf": 1}']) {
      const res = runCli(["mix", "--directions", file, "--points", JSON.stringify(CENTER), "--fine-tune", fineTune], env);
      assert.equal(res.code, 1, fineTune);
      const body = payload(res.json);
      assert.equal(body.error, "input", fineTune);
      assert.ok(String(body.message).includes("知らないキー"), fineTune);
    }
  } finally {
    cleanup();
  }
});

void test("同じ入力の mix は同じ結果を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const file = writeJson(dir, "directions.json", [MINIMAL, WA_MODERN, POP]);
    const args = ["mix", "--directions", file, "--points", JSON.stringify(MIX_POINTS)];
    const first = directionOf(runCli(args, env).json);
    const second = directionOf(runCli(args, env).json);
    assert.deepEqual(second, first);
  } finally {
    cleanup();
  }
});

void test("points が範囲外・軸が欠けている・directions の件数が外れれば終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const three = writeJson(dir, "three.json", [MINIMAL, WA_MODERN, POP]);
    const zero = writeJson(dir, "zero.json", []);
    const five = writeJson(dir, "five.json", [MINIMAL, WA_MODERN, POP, CORPORATE, DARK_TECH]);
    const cases: { label: string; file: string; points: unknown }[] = [
      { label: "x が範囲外", file: three, points: { ...MIX_POINTS, color: { x: 1.5, y: 0 } } },
      { label: "y が負", file: three, points: { ...MIX_POINTS, color: { x: 0, y: -1 } } },
      { label: "color が欠けている", file: three, points: { font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } } },
      { label: "layout の y が欠けている", file: three, points: { ...MIX_POINTS, layout: { x: 0 } } },
      { label: "文字列の点", file: three, points: { ...MIX_POINTS, font: { x: "0", y: 0 } } },
      { label: "directions が 0 件", file: zero, points: MIX_POINTS },
      { label: "directions が 5 件", file: five, points: MIX_POINTS },
    ];
    for (const c of cases) {
      const res = runCli(["mix", "--directions", c.file, "--points", JSON.stringify(c.points)], env);
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
      { label: "points なし", args: ["mix", "--directions", good], error: "usage" },
      { label: "directions なし", args: ["mix", "--points", "{}"], error: "usage" },
      { label: "知らない引数", args: ["mix", "--directions", good, "--points", "{}", "--unknown", "x"], error: "usage" },
      { label: "points が JSON でない", args: ["mix", "--directions", good, "--points", "{oops"], error: "usage" },
      { label: "directions のファイルが無い", args: ["mix", "--directions", join(dir, "nothing.json"), "--points", "{}"], error: "file" },
      { label: "directions が壊れている", args: ["mix", "--directions", broken, "--points", "{}"], error: "file" },
      { label: "directions が配列でない", args: ["mix", "--directions", notArray, "--points", "{}"], error: "input" },
      { label: "direction の中身が不正", args: ["mix", "--directions", badDirection, "--points", "{}"], error: "input" },
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
    const res = runCli(["render-direction", "--style", "pop", "--family", "lp"], fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.themeId, "pop");
    assert.equal(json.family, "lp");
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
    const args = ["render-direction", "--style", "pop", "--family", "lp"];
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
    const fallback = runCli(["render-direction", "--direction", file, "--family", "dashboard"], fakeEnv(env));
    assert.equal(fallback.code, 0, fallback.stderr);
    const dark = payload(fallback.json);
    assert.equal(dark.themeId, "dark-tech");
    assert.equal(dark.layout, "sidebar");
    assert.equal(dark.mode, "dark");
    assert.ok(String(dark.html).includes('data-mode="dark"'));

    const overridden = payload(
      runCli(["render-direction", "--direction", file, "--family", "dashboard", "--mode", "light"], fakeEnv(env)).json,
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
    const mixed = directionOf(runCli(["mix", "--directions", directions, "--points", JSON.stringify(MIX_POINTS)], env).json);
    const file = writeJson(dir, "mixed.json", mixed);
    const res = runCli(["render-direction", "--direction", file, "--family", "blog"], fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.themeId, mixed.id);
    // 配置の軸は A の隅 (先頭の案) を指すので、骨組みの並べは先頭の案のもの
    assert.equal(json.layout, MINIMAL.layouts.blog);
    assert.ok(String(json.html).includes(`data-theme="${String(mixed.id)}"`));
  } finally {
    cleanup();
  }
});

void test("render-direction の引数の誤りは終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const cases: { label: string; args: string[]; error: string }[] = [
      { label: "引数なし", args: ["render-direction"], error: "usage" },
      { label: "family なし", args: ["render-direction", "--style", "pop"], error: "usage" },
      { label: "style も direction もなし", args: ["render-direction", "--family", "lp"], error: "usage" },
      {
        label: "style と direction の同時指定",
        args: ["render-direction", "--style", "pop", "--direction", "x.json", "--family", "lp"],
        error: "usage",
      },
      { label: "知らない style", args: ["render-direction", "--style", "nope", "--family", "lp"], error: "usage" },
      { label: "知らない family", args: ["render-direction", "--style", "pop", "--family", "nope"], error: "input" },
      { label: "知らない mode", args: ["render-direction", "--style", "pop", "--family", "lp", "--mode", "sepia"], error: "input" },
      { label: "知らない引数", args: ["render-direction", "--style", "pop", "--family", "lp", "--unknown", "x"], error: "usage" },
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
      const res = runCli(["render-direction", "--direction", c.file, "--family", "lp"], fakeEnv(env));
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, c.error, c.label);
    }
  } finally {
    cleanup();
  }
});

// 面の台帳の CSS。id が見つからなければテストの読み込み時に止める
function surfaceCssOf(id: string): string {
  const surface = findSurface(id);
  if (surface === undefined) throw new Error(`data/surfaces.json に ${id} がありません`);
  return surface.css;
}

void test("render-direction --surface は面の CSS をテーマの style のあとに重ね、check-page が通る", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const outFile = join(dir, "glass-lp.html");
    const args = ["render-direction", "--style", "minimal", "--family", "lp", "--surface", "glass", "--out", outFile];
    const res = runCli(args, fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.equal(json.surface, "glass");
    assert.equal(json.html, null);

    const html = readFileSync(outFile, "utf8");
    const surfaceIndex = html.indexOf('<style id="surface">');
    const themeIndex = html.indexOf(THEME_STYLE_TAG);
    assert.ok(themeIndex !== -1, "テーマの style がある");
    assert.ok(surfaceIndex > themeIndex, "面の style はテーマの style より後ろ");
    assert.ok(html.includes(surfaceCssOf("glass")), "面の CSS がそのまま入っている");

    const check = payload(runCli(["check-page", "--html", outFile], env).json);
    assert.equal(check.ok, true, JSON.stringify(check.disallowed));
    assert.equal(record(check.motion, "motion").hasMotion, false);
  } finally {
    cleanup();
  }
});

void test("material と solid の面でも check-page が通り、面の style が入る", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    for (const id of ["material", "solid"]) {
      const outFile = join(dir, `${id}-lp.html`);
      const res = runCli(["render-direction", "--style", "minimal", "--family", "lp", "--surface", id, "--out", outFile], fakeEnv(env));
      assert.equal(res.code, 0, res.stderr);
      assert.equal(payload(res.json).surface, id);

      const html = readFileSync(outFile, "utf8");
      assert.ok(html.includes('<style id="surface">'), id);
      assert.ok(html.includes(surfaceCssOf(id)), id);

      const check = payload(runCli(["check-page", "--html", outFile], env).json);
      assert.equal(check.ok, true, `${id}: ${JSON.stringify(check.disallowed)}`);
      assert.equal(record(check.motion, "motion").hasMotion, false, id);
    }
  } finally {
    cleanup();
  }
});

void test("--surface none と省略は同じ HTML で、どちらも面の style を持たない", () => {
  const { env, cleanup } = tempEnv();
  try {
    const base = ["render-direction", "--style", "minimal", "--family", "lp"];
    const omitted = payload(runCli(base, fakeEnv(env)).json);
    const none = payload(runCli([...base, "--surface", "none"], fakeEnv(env)).json);
    assert.equal(omitted.surface, "none");
    assert.equal(none.surface, "none");
    assert.equal(none.html, omitted.html);
    assert.ok(!String(none.html).includes('id="surface"'));
  } finally {
    cleanup();
  }
});

void test("知らない --surface は終了コード 1 の input で、面の id を並べる", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["render-direction", "--style", "minimal", "--family", "lp", "--surface", "no-such"], fakeEnv(env));
    assert.equal(res.code, 1);
    const body = payload(res.json);
    assert.equal(body.error, "input");
    assert.deepEqual(body.surfaces, ["none", "material", "glass", "solid"]);
  } finally {
    cleanup();
  }
});

void test("style-guide が無ければ render-direction は終了コード 2 の style-guide-missing", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const res = runCli(["render-direction", "--style", "pop", "--family", "lp"], {
      ...env,
      STYLE_GUIDE_DIR: join(dir, "no-such-style-guide"),
    });
    assert.equal(res.code, 2);
    assert.equal(payload(res.json).error, "style-guide-missing");
  } finally {
    cleanup();
  }
});
