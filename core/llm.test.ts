// core/llm.ts を、テスト用のモック (app/mock-llm.mjs) で確かめる。
// 本物の claude は使わない (DESIGN_STUDIO_LLM_CMD をモックに向ける)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LlmError, generateDirections, generatePage, llmAvailable } from "./llm.ts";
import type { FontPair } from "./llm.ts";
import { findDisallowedUrls, hasPageCsp } from "./page-html.ts";
import { loadStyles, validateDirection } from "./styles.ts";
import type { Direction } from "./types.ts";

const MOCK = fileURLToPath(new URL("../app/mock-llm.mjs", import.meta.url));
const DIRECTION_IDS = ["dir-a", "dir-b", "dir-c"];
const PROMPT = "請求書の SaaS。落ち着いた雰囲気で。";
const CSS_FOR_PAGE = "@theme { --color-brand-accent: oklch(0.7 0.12 30); }";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap";
// モックのページが入れている仮のテーマ (差し替えで消えるのを見る)
const MOCK_THEME = "呼び出し側が差し替える";

// フォントの組 (本来はサーバーが style-guide の data/fonts.json から読んで渡す)
const FONT_PAIRS: FontPair[] = [
  {
    id: "noto-sans-jp+noto-sans-jp",
    heading: "Noto Sans JP",
    body: "Noto Sans JP",
    mono: "JetBrains Mono",
    mood: "humanist",
    japanese: true,
  },
];

// ページの題材にするスタイル (data/styles.json)
function styleOf(id: string): Direction {
  const found = loadStyles().find((style) => style.id === id);
  if (found === undefined) throw new Error(`data/styles.json に ${id} がありません`);
  return found;
}

const MINIMAL = styleOf("minimal");

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

type RecordedArgs = { argv: string[]; addDir: string | null; addDirFiles: string[] | null };

// モックが書いた、受け取った引数の記録を読む
function recordedArgs(dir: string): RecordedArgs {
  const raw: unknown = JSON.parse(readFileSync(join(dir, "args.json"), "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error("引数の記録がオブジェクトではありません");
  return raw as RecordedArgs;
}

// 引数から --flag の値を引く
function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

// LlmError の code を見る述語
function llmFailure(code: string): (e: unknown) => boolean {
  return (e: unknown): boolean => e instanceof LlmError && e.code === code;
}

void test("generateDirections は 3 件を返し、どれも検証を通り、id は dir-a / dir-b / dir-c", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const directions = await generateDirections({ prompt: PROMPT, pageType: "lp", fontPairs: FONT_PAIRS }, env);
    assert.equal(directions.length, 3);
    directions.forEach((direction, index) => {
      assert.deepEqual(validateDirection(direction), direction);
      assert.equal(direction.id, DIRECTION_IDS[index]);
      assert.equal(direction.seed.id, direction.id);
    });
    const args = recordedArgs(dir);
    assert.ok(args.argv.includes("--json-schema"));
    assert.equal(flagValue(args.argv, "--tools"), "", "スクリーンショット無しでは --tools は空");
    assert.equal(flagValue(args.argv, "--add-dir"), undefined, "--add-dir は付かない");
  } finally {
    cleanup();
  }
});

void test("bad-then-good は、1 回目の不正な出力のあとやり直して成功する", async () => {
  const { dir, env, cleanup } = mockEnv("bad-then-good");
  try {
    const directions = await generateDirections({ prompt: PROMPT, pageType: "dashboard", fontPairs: FONT_PAIRS }, env);
    assert.equal(directions.length, 3);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("error モードでは LlmError", async () => {
  const { env, cleanup } = mockEnv("error");
  try {
    await assert.rejects(
      () => generateDirections({ prompt: PROMPT, pageType: "lp", fontPairs: FONT_PAIRS }, env),
      llmFailure("llm-failed"),
    );
  } finally {
    cleanup();
  }
});

void test("generatePage は検証を通った HTML を返し、テーマは cssForPage に差し替える", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    const input = { prompt: PROMPT, direction: MINIMAL, pageType: "lp" as const, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL };
    const html = await generatePage(input, env);
    assert.deepEqual(findDisallowedUrls(html), []);
    assert.ok(html.includes('id="theme"'), 'id="theme" の style');
    assert.ok(html.includes(`data-theme="${MINIMAL.seed.id}"`), "data-theme");
    assert.ok(html.includes(CSS_FOR_PAGE), "テーマの CSS を差し替えている");
    assert.ok(!html.includes(MOCK_THEME), "LLM が書いた仮のテーマは残らない");
    assert.ok(hasPageCsp(html), "CSP の meta");
  } finally {
    cleanup();
  }
});

void test("bad-then-good はページでも、1 回目の不正な出力のあとやり直して成功する", async () => {
  const { dir, env, cleanup } = mockEnv("bad-then-good");
  try {
    const input = { prompt: PROMPT, direction: MINIMAL, pageType: "lp" as const, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL };
    const html = await generatePage(input, env);
    assert.deepEqual(findDisallowedUrls(html), []);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("bad-page は LlmError (code bad-page)", async () => {
  const { env, cleanup } = mockEnv("bad-page");
  try {
    const input = { prompt: PROMPT, direction: MINIMAL, pageType: "lp" as const, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL };
    await assert.rejects(() => generatePage(input, env), llmFailure("bad-page"));
  } finally {
    cleanup();
  }
});

void test("no-csp (CSP の meta の無いページ) は LlmError (code bad-page)", async () => {
  const { env, cleanup } = mockEnv("no-csp");
  try {
    const input = { prompt: PROMPT, direction: MINIMAL, pageType: "lp" as const, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL };
    await assert.rejects(() => generatePage(input, env), llmFailure("bad-page"));
  } finally {
    cleanup();
  }
});

void test("llmAvailable はモックで true、存在しないコマンドで false", () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    assert.equal(llmAvailable(env), true);
    assert.equal(llmAvailable({ ...env, DESIGN_STUDIO_LLM_CMD: JSON.stringify(["design-studio-no-such-llm-command"]) }), false);
  } finally {
    cleanup();
  }
});

void test("スクリーンショットを渡すと、コピーした 1 ファイルだけを読める指定が引数に入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const shot = join(dir, "mood.png");
    writeFileSync(shot, "not an image", "utf8");
    const directions = await generateDirections({ prompt: PROMPT, pageType: "lp", screenshotPath: shot, fontPairs: FONT_PAIRS }, env);
    assert.equal(directions.length, 3);
    const args = recordedArgs(dir);
    assert.equal(flagValue(args.argv, "--tools"), "Read");
    const addDir = args.addDir;
    assert.ok(typeof addDir === "string" && addDir !== dir, "参考画像の一時ディレクトリを指す");
    assert.deepEqual(args.addDirFiles, ["screenshot.png"], "コピーしたファイルだけが入っている");
  } finally {
    cleanup();
  }
});
