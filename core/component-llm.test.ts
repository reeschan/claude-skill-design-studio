// core/component-llm.ts を、テスト用のモック (app/mock-llm.mjs) で確かめる。
// 本物の claude は使わない (DESIGN_STUDIO_LLM_CMD をモックに向ける)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateComponent } from "./component-llm.ts";
import type { GenerateComponentInput } from "./component-llm.ts";
import { LlmError } from "./llm.ts";
import { checkMotion, findDisallowedUrls, hasPageCsp } from "./page-html.ts";
import { loadStyles } from "./styles.ts";
import { findMotion, findSurface } from "./treatment.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";
import type { Brief, ComponentTarget, Direction, Treatment } from "./types.ts";

const MOCK = fileURLToPath(new URL("../app/mock-llm.mjs", import.meta.url));
const CSS_FOR_PAGE = "@theme { --color-brand-accent: oklch(0.7 0.12 30); }";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap";
// モックの HTML が入れている仮のテーマ (差し替えで消えるのを見る)
const MOCK_THEME = "呼び出し側が差し替える";

// 依頼の 4 項目
const BRIEF: Brief = {
  what: "請求書の SaaS を作りたい",
  mood: "落ち着いた和風",
  audience: "フリーランスの経理担当",
  mustHave: "PDF 出力",
};

// 部品の題材にするスタイル (data/styles.json)
function styleOf(id: string): Direction {
  const found = loadStyles().find((style) => style.id === id);
  if (found === undefined) throw new Error(`data/styles.json に ${id} がありません`);
  return found;
}

const MINIMAL = styleOf("minimal");

// 検証する 3 つの作るもの (部品帳・候補の部品・自由な名前の部品)
const TARGETS: ComponentTarget[] = [
  { kind: "component-sheet" },
  { kind: "component", name: "ボタン" },
  { kind: "component", name: "日付ピッカー" },
];

// generateComponent に渡す入力。テストごとに違うのは target と treatment だけ
function componentInput(target: ComponentTarget, treatment?: Treatment): GenerateComponentInput {
  return {
    brief: BRIEF,
    direction: MINIMAL,
    target,
    cssForPage: CSS_FOR_PAGE,
    fontsUrl: FONTS_URL,
    ...(treatment === undefined ? {} : { treatment }),
  };
}

type MockEnv = { dir: string; env: NodeJS.ProcessEnv; cleanup: () => void };

// モックを DESIGN_STUDIO_LLM_CMD に差し込んだ env と、後片付けを返す
function mockEnv(mode: string): MockEnv {
  const dir = mkdtempSync(join(tmpdir(), "design-studio-llm-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESIGN_STUDIO_LLM_CMD: JSON.stringify([process.execPath, MOCK]),
    MOCK_LLM_MODE: mode,
    MOCK_LLM_COUNTER: join(dir, "counter.txt"),
    MOCK_LLM_ARGS_FILE: join(dir, "args.json"),
  };
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

type RecordedArgs = { argv: string[]; addDir: string | null; addDirFiles: string[] | null; prompt: string };

// モックが書いた、受け取った引数・プロンプトの記録を読む
function recordedArgs(dir: string): RecordedArgs {
  const raw: unknown = JSON.parse(readFileSync(join(dir, "args.json"), "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error("引数の記録がオブジェクトではありません");
  return raw as RecordedArgs;
}

// プロンプトの 2 行目 (作るものの行)
function makeLine(prompt: string): string | undefined {
  return prompt.split("\n")[1];
}

// プロンプトから <component_name> の中身を除く (名前がタグの外に漏れていないかを見る)
function withoutComponentNames(prompt: string): string {
  return prompt.replace(/<component_name>[\s\S]*?<\/component_name>/g, "");
}

// LlmError の code を見る述語
function llmFailure(code: string): (e: unknown) => boolean {
  return (e: unknown): boolean => e instanceof LlmError && e.code === code;
}

void test("generateComponent は部品帳・候補の部品・自由な名前の部品のどれも、殻と点検を通った HTML を返す", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    for (const target of TARGETS) {
      const html = await generateComponent(componentInput(target), env);
      assert.ok(hasPageCsp(html), "CSP の meta がある");
      assert.deepEqual(findDisallowedUrls(html), [], "許可していない URL は無い");
      assert.equal(checkMotion(html).ok, true, "動きの点検を通る");
      assert.ok(html.includes(`data-theme="${MINIMAL.seed.id}"`), "data-theme は方向性の seed の id");
      assert.ok(html.includes(CSS_FOR_PAGE), "テーマの style の中身は cssForPage");
      assert.ok(!html.includes(MOCK_THEME), "LLM が書いた仮のテーマは残らない");
    }
  } finally {
    cleanup();
  }
});

void test("部品帳のプロンプトは、2 行目が作るものの行で、10 個の部品の名前をこの順で全部並べる", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    await generateComponent(componentInput({ kind: "component-sheet" }), env);
    const prompt = recordedArgs(dir).prompt;
    assert.equal(makeLine(prompt), "作るもの: component-sheet", "2 行目が作るものの行");
    let previous = -1;
    for (const candidate of COMPONENT_CANDIDATES) {
      const index = prompt.indexOf(candidate.name);
      assert.ok(index !== -1, `部品 ${candidate.id} の名前がありません`);
      assert.ok(index > previous, `部品 ${candidate.id} の並びが候補の順と違います`);
      previous = index;
    }
    assert.ok(prompt.includes("## 見せ方"), "見せ方の節");
    assert.ok(prompt.includes("position: relative"), "モーダル・トーストは相対配置の枠の中");
    assert.ok(prompt.includes("position: fixed"), "画面全体に固定で被せない");
    assert.ok(prompt.includes(":focus-visible"), "CSS だけで手触りを出す");
  } finally {
    cleanup();
  }
});

void test("部品のプロンプトは、2 行目が作るものの行で、名前を <component_name> の中にだけ置く", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    for (const name of ["ボタン", "日付ピッカー"]) {
      await generateComponent(componentInput({ kind: "component", name }), env);
      const prompt = recordedArgs(dir).prompt;
      assert.equal(makeLine(prompt), "作るもの: component", "2 行目が作るものの行");
      assert.ok(prompt.includes(`<component_name>${name}</component_name>`), "名前は <component_name> の中");
      assert.ok(!withoutComponentNames(prompt).includes(name), "名前は <component_name> の外に出さない");
    }
  } finally {
    cleanup();
  }
});

void test("表現を渡すと、面 Glass の指示と、指定した 2 件の動きの見本がプロンプトに入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const glass = findSurface("glass");
    const aurora = findMotion("aurora");
    const marquee = findMotion("marquee");
    assert.ok(glass !== undefined && aurora !== undefined && marquee !== undefined, "台帳に glass・aurora・marquee がある");
    await generateComponent(
      componentInput({ kind: "component", name: "ボタン" }, { surface: "glass", motion: "animated", motionSamples: ["aurora", "marquee"] }),
      env,
    );
    const prompt = recordedArgs(dir).prompt;
    assert.ok(prompt.includes("## 表現"), "「## 表現」の節");
    assert.ok(prompt.includes(glass.name), "面の名前 (Glass)");
    const firstInstruction = glass.instructions[0];
    assert.ok(firstInstruction !== undefined, "glass の instructions が空です");
    assert.ok(prompt.includes(firstInstruction), "面の台帳の指示");
    for (const sample of [aurora, marquee]) {
      assert.ok(prompt.includes(`"id":"${sample.id}"`), `見本 ${sample.id} の id`);
    }
  } finally {
    cleanup();
  }
});

void test("treatment を省くと、プロンプトに「## 表現」が無い", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    await generateComponent(componentInput({ kind: "component-sheet" }), env);
    const omitted = recordedArgs(dir).prompt;
    await generateComponent(componentInput({ kind: "component-sheet" }, { surface: "none", motion: "none", motionSamples: [] }), env);
    const explicit = recordedArgs(dir).prompt;
    assert.ok(!omitted.includes("## 表現"), "省いたときは「## 表現」を足さない");
    assert.equal(explicit, omitted, "既定の表現のときも、省いたときと同じプロンプト");
  } finally {
    cleanup();
  }
});

void test("no-reduced-motion は 2 回呼んで LlmError (code bad-component) になる", async () => {
  const { dir, env, cleanup } = mockEnv("no-reduced-motion");
  try {
    await assert.rejects(
      () => generateComponent(componentInput({ kind: "component-sheet" }), env),
      (e: unknown) => e instanceof LlmError && e.code === "bad-component" && e.message.includes("prefers-reduced-motion"),
    );
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("motion-then-good は、reduced-motion の無い HTML のあとやり直して 2 回目の HTML を返す", async () => {
  const { dir, env, cleanup } = mockEnv("motion-then-good");
  try {
    const html = await generateComponent(componentInput({ kind: "component", name: "日付ピッカー" }), env);
    assert.equal(checkMotion(html).ok, true, "返った HTML は動きの点検を通る");
    assert.deepEqual(findDisallowedUrls(html), []);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("bad-page は LlmError (code bad-component)", async () => {
  const { env, cleanup } = mockEnv("bad-page");
  try {
    await assert.rejects(() => generateComponent(componentInput({ kind: "component", name: "ボタン" }), env), llmFailure("bad-component"));
  } finally {
    cleanup();
  }
});
