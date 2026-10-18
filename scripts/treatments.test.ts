// treatments サブコマンドと表現の core を確かめる。style-guide は test/fixtures の偽物を使う
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CliExit } from "../core/cli-exit.ts";
import { validateTreatment } from "../core/treatment.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const FAKE_GUIDE = fileURLToPath(new URL("../test/fixtures/fake-style-guide", import.meta.url));

// 取り決めの 2 節の表の 12 件 (id の並び)
const MOTION_IDS = [
  "spinning-border",
  "shimmer-text",
  "scroll-reveal",
  "reading-progress",
  "entry-transition",
  "spring-press",
  "stagger",
  "aurora",
  "skeleton-shimmer",
  "line-draw",
  "blob",
  "marquee",
] as const;

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

// 応答の 1 項目を文字列として読む
function textOf(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} が文字列ではありません: ${JSON.stringify(value)}`);
  return value;
}

// 偽 style-guide を STYLE_GUIDE_DIR に向けた env を返す
function fakeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, STYLE_GUIDE_DIR: FAKE_GUIDE };
}

// 応答の motions をオブジェクトの配列として読む
function motionsOf(json: unknown): Record<string, unknown>[] {
  const { motions } = payload(json);
  if (!Array.isArray(motions)) throw new Error("motions が配列ではありません");
  return motions.map((item, index) => record(item, `motions[${index}]`));
}

// 配列の各項目の id を並べる
function idsOf(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} が配列ではありません`);
  return value.map((item, index) => textOf(record(item, `${label}[${index}]`).id, `${label}[${index}].id`));
}

void test("treatments は面 4 件と動きの見本 12 件を返す", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["treatments"], env);
    assert.equal(res.code, 0, res.stderr);
    const body = payload(res.json);
    assert.deepEqual(idsOf(body.surfaces, "surfaces"), ["none", "material", "glass", "solid"]);
    assert.deepEqual(idsOf(body.motions, "motions"), [...MOTION_IDS]);
  } finally {
    cleanup();
  }
});

void test("treatments extra は usage で終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["treatments", "extra"], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "usage");
  } finally {
    cleanup();
  }
});

void test("treatments motion は 12 件とも殻に入れた HTML を書き、check-page が ok になる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const fake = fakeEnv(env);
    const listing = runCli(["treatments"], env);
    assert.equal(listing.code, 0, listing.stderr);
    const samples = motionsOf(listing.json);
    assert.equal(samples.length, MOTION_IDS.length);

    for (const sample of samples) {
      const id = textOf(sample.id, "motion.id");
      const css = textOf(sample.css, "motion.css");
      const file = join(dir, `${id}.html`);
      const res = runCli(["treatments", "motion", id, "--out", file], fake);
      assert.equal(res.code, 0, `${id}: ${res.stderr}`);
      const body = payload(res.json);
      assert.equal(body.id, id);
      assert.equal(body.style, "minimal");
      assert.equal(body.mode, "light");
      assert.equal(body.file, file);
      assert.equal(body.html, null);

      const html = readFileSync(file, "utf8");
      assert.ok(html.includes('<style id="motion">'), `${id}: style id="motion" がある`);
      assert.ok(html.includes(css), `${id}: 見本の css がある`);

      const checkRes = runCli(["check-page", "--html", file], fake);
      assert.equal(checkRes.code, 0, `${id}: ${checkRes.stderr}`);
      const check = payload(checkRes.json);
      assert.equal(check.ok, true, `${id}: ${JSON.stringify(check.disallowed)}`);
      const motion = record(check.motion, `${id}.motion`);
      assert.equal(motion.hasMotion, true, id);
      assert.equal(motion.hasReducedMotion, true, id);
    }
  } finally {
    cleanup();
  }
});

void test("treatments motion の知らない id・--style・--mode は終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const fake = fakeEnv(env);
    const cases: { label: string; args: string[]; error: string }[] = [
      { label: "知らない見本", args: ["treatments", "motion", "no-such"], error: "input" },
      { label: "知らない style", args: ["treatments", "motion", "spinning-border", "--style", "no-such"], error: "input" },
      { label: "知らない mode", args: ["treatments", "motion", "spinning-border", "--mode", "sepia"], error: "input" },
      { label: "id が無い", args: ["treatments", "motion"], error: "usage" },
      { label: "id が 2 つ", args: ["treatments", "motion", "spinning-border", "aurora"], error: "usage" },
    ];
    for (const c of cases) {
      const res = runCli(c.args, fake);
      assert.equal(res.code, 1, c.label);
      assert.equal(payload(res.json).error, c.error, c.label);
    }
  } finally {
    cleanup();
  }
});

void test("validateTreatment は既定を写し、省略を none にし、motionSamples を animated のときだけ残す", () => {
  assert.deepEqual(validateTreatment(undefined), { surface: "none", motion: "none", motionSamples: [] });
  assert.deepEqual(validateTreatment(null), { surface: "none", motion: "none", motionSamples: [] });
  assert.deepEqual(validateTreatment({ surface: "glass", motion: "animated", motionSamples: ["aurora", "marquee"] }), {
    surface: "glass",
    motion: "animated",
    motionSamples: ["aurora", "marquee"],
  });
  assert.deepEqual(validateTreatment({ surface: "glass", motion: "subtle", motionSamples: ["aurora"] }), {
    surface: "glass",
    motion: "subtle",
    motionSamples: [],
  });
  assert.deepEqual(validateTreatment({}), { surface: "none", motion: "none", motionSamples: [] });

  const first = validateTreatment(undefined);
  first.motionSamples.push("aurora");
  assert.deepEqual(validateTreatment(undefined).motionSamples, []);
});

void test("validateTreatment は台帳に無い surface・MOTION_LEVELS 以外の motion・知らない見本・重複・5 件を CliExit(1) で止める", () => {
  const five = [...MOTION_IDS].slice(0, 5);
  const cases: { label: string; value: unknown }[] = [
    { label: "台帳に無い surface", value: { surface: "chrome" } },
    { label: "MOTION_LEVELS 以外の motion", value: { motion: "wild" } },
    { label: "知らない見本", value: { surface: "glass", motion: "animated", motionSamples: ["no-such"] } },
    { label: "重複", value: { surface: "glass", motion: "animated", motionSamples: ["aurora", "aurora"] } },
    { label: "5 件", value: { surface: "glass", motion: "animated", motionSamples: five } },
    { label: "配列でない motionSamples", value: { motionSamples: "aurora" } },
    { label: "オブジェクトでない", value: "nope" },
  ];
  for (const c of cases) {
    assert.throws(
      () => validateTreatment(c.value),
      (e: unknown) => e instanceof CliExit && e.code === 1,
      c.label,
    );
  }
});
