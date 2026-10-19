// 保存 (core/project.ts) の背景スケッチを CLI の外から確かめる。
// DESIGN_STUDIO_HOME は一時ディレクトリに向け、終わったら消す
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readProject, saveProject } from "./project.ts";
import { findStyle } from "./styles.ts";
import type { BackgroundSketch, Direction, PageType } from "./types.ts";

const STYLE = findStyle("minimal");
if (STYLE === undefined) throw new Error("data/styles.json に minimal がありません");
const DIRECTION: Direction = {
  id: STYLE.id,
  name: STYLE.name,
  rationale: STYLE.rationale,
  seed: STYLE.seed,
  layouts: STYLE.layouts,
  copy: STYLE.copy,
};

// パッドの点。4 軸とも A の隅 (0, 0)
const POINT_A = { x: 0, y: 0 };
const POINTS_A = { color: POINT_A, font: POINT_A, shape: POINT_A, layout: POINT_A };

// 表現の既定
const DEFAULT_TREATMENT = { surface: "none", motion: "none", motionSamples: [] };

const LP_PAGE_TYPE: PageType = { name: "LP", family: "lp" };

// 背景スケッチの例 2 つ。2 つ目は別の値に保存し直すときに使う
const SAMPLE_BACKGROUND: BackgroundSketch = {
  source: "sample",
  sampleId: "linen",
  code: "circle(100, 100, 40)",
  placement: "hero",
  motion: "slow",
};
const PASTE_BACKGROUND: BackgroundSketch = {
  source: "paste",
  sampleId: null,
  code: "square(10, 10, 80)",
  placement: "page",
  motion: "still",
};

// 依頼。what 以外は空
function briefJson(what: string): Record<string, string> {
  return { what, mood: "", audience: "", mustHave: "" };
}

// 版 3 の project.json の中身 (createdAt・updatedAt は保存する側が決める)
function projectJsonV3(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id,
    brief: briefJson("背景を付ける"),
    pageType: LP_PAGE_TYPE,
    treatment: DEFAULT_TREATMENT,
    rounds: [{ drafts: [DIRECTION], edits: [null] }],
    roundIndex: 0,
    points: POINTS_A,
    fineTune: {},
    items: [],
    ...overrides,
  };
}

// 版 2 の project.json の中身 (pages は pages/ の item に直す前の形)
function projectJsonV2(id: string): Record<string, unknown> {
  return {
    version: 2,
    id,
    brief: briefJson("背景を付ける"),
    pageType: LP_PAGE_TYPE,
    rounds: [{ drafts: [DIRECTION], edits: [null] }],
    roundIndex: 0,
    points: POINTS_A,
    fineTune: {},
    pages: [],
  };
}

// 版が無い古い形の project.json
function oldProjectJson(id: string): Record<string, unknown> {
  return {
    id,
    prompt: "古い依頼",
    pageType: "lp",
    direction: DIRECTION,
    pages: ["lp"],
  };
}

type TempHome = { env: NodeJS.ProcessEnv; cleanup: () => void };

// 一時ディレクトリを作り、置き場をそこに向けた env と後片付けを返す
function tempHome(): TempHome {
  const dir = mkdtempSync(join(tmpdir(), "design-studio-"));
  const env: NodeJS.ProcessEnv = { ...process.env, DESIGN_STUDIO_HOME: join(dir, "home") };
  return { env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// 入力の誤り (終了コード 1 の input) で止まることを確かめる
function assertInputError(fn: () => unknown, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input", label);
}

// 置き場に project.json を直接置く (保存を通さず、background のキーが無い保存を読む)
function writeProjectJson(env: NodeJS.ProcessEnv, id: string, project: Record<string, unknown>): void {
  const dir = join(env.DESIGN_STUDIO_HOME ?? "", "projects", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");
}

// 置いた project.json を読み、background を返す
function readBackground(env: NodeJS.ProcessEnv, id: string): unknown {
  const found = readProject(env, id);
  assert.notEqual(found, null, `${id} を読める`);
  return found?.project.background;
}

void test("background 付きの版 3 を保存して読み戻すと background が同じ値", () => {
  const { env, cleanup } = tempHome();
  try {
    const saved = saveProject(env, { project: projectJsonV3("with-bg", { background: SAMPLE_BACKGROUND }) });
    assert.deepEqual(saved.background, SAMPLE_BACKGROUND);

    const found = readProject(env, "with-bg");
    assert.notEqual(found, null, "保存したプロジェクトを読める");
    assert.deepEqual(found?.project.background, SAMPLE_BACKGROUND, "読み戻しても同じ値");
  } finally {
    cleanup();
  }
});

void test("background の無い版 3・版 2・版なしの project.json を読むと background が null", () => {
  const { env, cleanup } = tempHome();
  try {
    const times = { createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:05.000Z" };
    writeProjectJson(env, "no-bg", { ...projectJsonV3("no-bg"), ...times });
    writeProjectJson(env, "v2", { ...projectJsonV2("v2"), ...times });
    writeProjectJson(env, "old", { ...oldProjectJson("old"), ...times });

    assert.equal(readBackground(env, "no-bg"), null, "background の無い版 3");
    assert.equal(readBackground(env, "v2"), null, "版 2");
    assert.equal(readBackground(env, "old"), null, "版なし");
  } finally {
    cleanup();
  }
});

void test("background を別の値に保存し直すと新しい値だけが残り、null で保存すると null", () => {
  const { env, cleanup } = tempHome();
  try {
    saveProject(env, { project: projectJsonV3("again", { background: SAMPLE_BACKGROUND }) });

    saveProject(env, { project: projectJsonV3("again", { background: PASTE_BACKGROUND }) });
    const found = readProject(env, "again");
    assert.notEqual(found, null, "保存したプロジェクトを読める");
    assert.deepEqual(found?.project.background, PASTE_BACKGROUND, "新しい値だけが残る");

    saveProject(env, { project: projectJsonV3("again", { background: null }) });
    const cleared = readProject(env, "again");
    assert.notEqual(cleared, null, "null で保存したプロジェクトを読める");
    assert.equal(cleared?.project.background, null, "null で保存すると null");
  } finally {
    cleanup();
  }
});

void test("background の形が違うと saveProject は入力の誤りで、初回なら保存しない", () => {
  const { env, cleanup } = tempHome();
  try {
    const cases: { id: string; label: string; background: unknown }[] = [
      { id: "bad-source", label: "source が未知", background: { ...SAMPLE_BACKGROUND, source: "video" } },
      { id: "empty-code", label: "code が空", background: { ...SAMPLE_BACKGROUND, code: "" } },
    ];
    for (const c of cases) {
      assertInputError(() => saveProject(env, { project: projectJsonV3(c.id, { background: c.background }) }), c.label);
      assert.equal(readProject(env, c.id), null, `${c.label}: 何も保存しない`);
    }
  } finally {
    cleanup();
  }
});
