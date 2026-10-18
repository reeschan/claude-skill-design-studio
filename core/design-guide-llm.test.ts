// core/design-guide-llm.ts を、テスト用のモック (app/mock-llm.mjs) で確かめる。
// 本物の claude は使わない (DESIGN_STUDIO_LLM_CMD をモックに向ける)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateDesignGuideValues } from "./design-guide-llm.ts";
import type { GenerateDesignGuideInput } from "./design-guide-llm.ts";
import { validateDesignGuideValues } from "./design-guide.ts";
import { LlmError } from "./llm.ts";
import { loadStyles } from "./styles.ts";
import { findMotion, findSurface } from "./treatment.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";
import type { Brief, Direction, Treatment } from "./types.ts";

const MOCK = fileURLToPath(new URL("../app/mock-llm.mjs", import.meta.url));

// 依頼の 4 項目
const BRIEF: Brief = {
  what: "請求書の SaaS を作りたい",
  mood: "落ち着いた和風",
  audience: "フリーランスの経理担当",
  mustHave: "PDF 出力",
};

// 方向性の題材にするスタイル (data/styles.json)
function styleOf(id: string): Direction {
  const found = loadStyles().find((style) => style.id === id);
  if (found === undefined) throw new Error(`data/styles.json に ${id} がありません`);
  return found;
}

const MINIMAL = styleOf("minimal");

// generateDesignGuideValues に渡す入力。テストごとに違うのは treatment だけ
function designGuideInput(treatment?: Treatment): GenerateDesignGuideInput {
  return { brief: BRIEF, direction: MINIMAL, ...(treatment === undefined ? {} : { treatment }) };
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

// 検証を通った値か (trim 済みの値を返すので、通った値はそのまま返る)
function assertValid(values: unknown): void {
  assert.deepEqual(validateDesignGuideValues(values), values, "返り値は validateDesignGuideValues を通る");
}

void test("既定のモードで、検証を通る値と 10 件の部品を返す", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    const values = await generateDesignGuideValues(designGuideInput(), env);
    assertValid(values);
    assert.equal(values.components.length, COMPONENT_CANDIDATES.length, "部品は 10 件");
    assert.deepEqual(
      values.components.map((component) => component.id),
      COMPONENT_CANDIDATES.map((candidate) => candidate.id),
      "部品の並びは候補の順",
    );
  } finally {
    cleanup();
  }
});

void test("プロンプトは、2 行目が作るものの行で、依頼・方向性・表現と、10 個の部品の名前を入れる", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const glass = findSurface("glass");
    const aurora = findMotion("aurora");
    const marquee = findMotion("marquee");
    assert.ok(glass !== undefined && aurora !== undefined && marquee !== undefined, "台帳に glass・aurora・marquee がある");
    await generateDesignGuideValues(designGuideInput({ surface: "glass", motion: "animated", motionSamples: ["aurora", "marquee"] }), env);
    const prompt = recordedArgs(dir).prompt;
    assert.equal(makeLine(prompt), "作るもの: design-guide", "2 行目が作るものの行");
    assert.ok(prompt.includes(BRIEF.what), "依頼の文");
    assert.ok(prompt.includes(BRIEF.mood), "依頼の雰囲気");
    assert.ok(prompt.includes(MINIMAL.name), "方向性の name");
    assert.ok(prompt.includes(glass.name), "面 glass の名前");
    assert.ok(prompt.includes(glass.description), "面 glass の説明");
    for (const sample of [aurora, marquee]) {
      assert.ok(prompt.includes(sample.name), `指定した動きの見本 ${sample.id} の名前`);
    }
    for (const candidate of COMPONENT_CANDIDATES) {
      assert.ok(
        prompt.includes(`<component_name>${candidate.name}</component_name>`),
        `部品 ${candidate.id} の名前は <component_name> の中`,
      );
      // 「表」は「表現」などふつうの言葉にも入るので、外への漏れは 2 文字以上の名前だけを見る
      if ([...candidate.name].length >= 2) {
        assert.ok(!withoutComponentNames(prompt).includes(candidate.name), `部品 ${candidate.id} の名前は <component_name> の外に出さない`);
      }
    }
  } finally {
    cleanup();
  }
});

void test("bad-then-good は、不正な値のあとやり直して 2 回目の値を返す", async () => {
  const { dir, env, cleanup } = mockEnv("bad-then-good");
  try {
    const values = await generateDesignGuideValues(designGuideInput(), env);
    assertValid(values);
    assert.equal(values.tone.words.voice, "です・ます", "返るのは 2 回目 (決まった値) の口調");
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("bad-page は LlmError (code bad-design-guide) になる", async () => {
  const { env, cleanup } = mockEnv("bad-page");
  try {
    await assert.rejects(() => generateDesignGuideValues(designGuideInput(), env), llmFailure("bad-design-guide"));
  } finally {
    cleanup();
  }
});

void test("error は LlmError (code llm-failed) になる", async () => {
  const { env, cleanup } = mockEnv("error");
  try {
    await assert.rejects(() => generateDesignGuideValues(designGuideInput(), env), llmFailure("llm-failed"));
  } finally {
    cleanup();
  }
});
