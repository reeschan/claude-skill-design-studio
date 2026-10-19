// core/llm.ts を、テスト用のモック (app/mock-llm.mjs) で確かめる。
// 本物の claude は使わない (DESIGN_STUDIO_LLM_CMD をモックに向ける)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LlmError, generateDirections, generatePage, htmlShapeLines, llmAvailable } from "./llm.ts";
import type { FontPair, GeneratePageInput } from "./llm.ts";
import { checkMotion, findDisallowedUrls, hasPageCsp } from "./page-html.ts";
import { loadStyles, validateDirection } from "./styles.ts";
import { findMotion, findSurface, loadMotions } from "./treatment.ts";
import { SKELETON_FAMILIES } from "./types.ts";
import type { Brief, Direction, MotionSample, SurfaceEntry, Treatment } from "./types.ts";

const MOCK = fileURLToPath(new URL("../app/mock-llm.mjs", import.meta.url));
const DIRECTION_IDS = ["dir-a", "dir-b", "dir-c", "dir-d"];
// 偽の LLM が family に答える値 (モックは決めて "pricing" と答える)
const MOCK_FAMILY = "pricing";
const CSS_FOR_PAGE = "@theme { --color-brand-accent: oklch(0.7 0.12 30); }";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap";
// モックのページが入れている仮のテーマ (差し替えで消えるのを見る)
const MOCK_THEME = "呼び出し側が差し替える";

// 依頼の 4 項目。空の項目の見方も見たいので、ここではすべて入っている
const BRIEF: Brief = {
  what: "請求書の SaaS を作りたい",
  mood: "落ち着いた和風",
  audience: "フリーランスの経理担当",
  mustHave: "PDF 出力",
};

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

// 面の台帳 (data/surfaces.json) の 1 件
function surfaceOf(id: string): SurfaceEntry {
  const found = findSurface(id);
  if (found === undefined) throw new Error(`data/surfaces.json に ${id} がありません`);
  return found;
}

// 動きの見本 (data/motions.json) の 1 件
function motionOf(id: string): MotionSample {
  const found = findMotion(id);
  if (found === undefined) throw new Error(`data/motions.json に ${id} がありません`);
  return found;
}

// generatePage に渡す入力。テストごとに違うのは treatment だけ
function pageInput(treatment?: Treatment): GeneratePageInput {
  return {
    brief: BRIEF,
    direction: MINIMAL,
    pageType: { name: "料金ページ", family: "pricing" },
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

// 引数から --flag の値を引く
function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

// --json-schema の値 (llm.ts が渡したスキーマ) を読む
function schemaOf(args: RecordedArgs): unknown {
  const text = flagValue(args.argv, "--json-schema");
  if (text === undefined) throw new Error("受け取った引数に --json-schema がありません");
  return JSON.parse(text);
}

// unknown を Record として取り出す (オブジェクトでなければ assert.fail で失敗させる)
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) assert.fail(`${label} はオブジェクトではありません`);
  return value as Record<string, unknown>;
}

// LlmError の code を見る述語
function llmFailure(code: string): (e: unknown) => boolean {
  return (e: unknown): boolean => e instanceof LlmError && e.code === code;
}

void test("generateDirections は 4 件を返し、どれも検証を通り、id は dir-a〜dir-d (family 無しでは LLM の答え)", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    const { directions, family } = await generateDirections({ brief: BRIEF, pageType: { name: "プラン比較" }, fontPairs: FONT_PAIRS }, env);
    assert.equal(family, MOCK_FAMILY, "family 無しでは偽の LLM が答えた family");
    assert.equal(directions.length, DIRECTION_IDS.length);
    directions.forEach((direction, index) => {
      assert.deepEqual(validateDirection(direction), direction);
      assert.equal(direction.id, DIRECTION_IDS[index]);
      assert.equal(direction.seed.id, direction.id);
    });
  } finally {
    cleanup();
  }
});

void test("bad-then-good は、1 回目の不正な出力のあとやり直して成功する", async () => {
  const { dir, env, cleanup } = mockEnv("bad-then-good");
  try {
    const { directions } = await generateDirections(
      { brief: BRIEF, pageType: { name: "料金ページ", family: "dashboard" }, fontPairs: FONT_PAIRS },
      env,
    );
    assert.equal(directions.length, DIRECTION_IDS.length);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("error モードでは LlmError", async () => {
  const { env, cleanup } = mockEnv("error");
  try {
    await assert.rejects(
      () => generateDirections({ brief: BRIEF, pageType: { name: "プラン比較" }, fontPairs: FONT_PAIRS }, env),
      llmFailure("llm-failed"),
    );
  } finally {
    cleanup();
  }
});

void test("family を渡すと、偽の LLM が pricing と答えても渡した family を返す", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    const { family } = await generateDirections(
      { brief: BRIEF, pageType: { name: "料金ページ", family: "blog" }, fontPairs: FONT_PAIRS },
      env,
    );
    assert.equal(family, "blog");
  } finally {
    cleanup();
  }
});

void test("案の layouts は骨組みの種類 7 種類すべてを持ち、--json-schema も family とそろえる", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const { directions } = await generateDirections({ brief: BRIEF, pageType: { name: "プラン比較" }, fontPairs: FONT_PAIRS }, env);
    directions.forEach((direction) => {
      assert.deepEqual(Object.keys(direction.layouts), [...SKELETON_FAMILIES], "layouts のキーは骨組みの種類 7 種類");
    });
    const args = recordedArgs(dir);
    const schema = asRecord(schemaOf(args), "スキーマ");
    assert.equal(schema.additionalProperties, false);
    const properties = asRecord(schema.properties, "スキーマの properties");
    const familySchema = asRecord(properties.family, "スキーマの properties.family");
    assert.deepEqual(familySchema.enum, [...SKELETON_FAMILIES], "family は骨組みの種類の enum で必須");
    assert.ok(Array.isArray(schema.required) && schema.required.includes("family"), "最上位の required に family");
    const directionsSchema = asRecord(properties.directions, "スキーマの properties.directions");
    assert.equal(directionsSchema.minItems, DIRECTION_IDS.length, "minItems は 4");
    assert.equal(directionsSchema.maxItems, DIRECTION_IDS.length, "maxItems は 4");
    const item = asRecord(directionsSchema.items, "directions の items");
    const itemProperties = asRecord(item.properties, "directions の items.properties");
    const layoutsSchema = asRecord(itemProperties.layouts, "directions の items.properties.layouts");
    assert.deepEqual(layoutsSchema.required, [...SKELETON_FAMILIES], "layouts の required も骨組みの種類 7 種類");
  } finally {
    cleanup();
  }
});

void test("directions のプロンプトには依頼の 4 項目 (見出し付き) と画面の種類の名前、family への指示が入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    await generateDirections({ brief: BRIEF, pageType: { name: "プラン比較" }, fontPairs: FONT_PAIRS }, env);
    const args = recordedArgs(dir);
    assert.ok(args.prompt.includes("### 作りたいもの\n請求書の SaaS を作りたい"), "作りたいもの");
    assert.ok(args.prompt.includes("### 雰囲気\n落ち着いた和風"), "雰囲気");
    assert.ok(args.prompt.includes("### 使う人\nフリーランスの経理担当"), "使う人");
    assert.ok(args.prompt.includes("### 入れたい要素\nPDF 出力"), "入れたい要素");
    assert.ok(args.prompt.includes("プラン比較"), "画面の種類の名前");
    assert.ok(args.prompt.includes("一番近い骨組みの種類を family"), "family に LLM に答えさせる指示");
  } finally {
    cleanup();
  }
});

void test("空の依頼の項目は (指定なし) と入れ、family があるときは LLM に family を答えさせない", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const brief: Brief = { what: "請求書の SaaS を作りたい", mood: "", audience: "", mustHave: "" };
    const { family } = await generateDirections({ brief, pageType: { name: "料金ページ", family: "pricing" }, fontPairs: FONT_PAIRS }, env);
    assert.equal(family, "pricing", "入力の family をそのまま返す");
    const args = recordedArgs(dir);
    assert.ok(args.prompt.includes("### 雰囲気\n(指定なし)"), "雰囲気は (指定なし)");
    assert.ok(args.prompt.includes("### 使う人\n(指定なし)"), "使う人は (指定なし)");
    assert.ok(args.prompt.includes("### 入れたい要素\n(指定なし)"), "入れたい要素は (指定なし)");
    assert.ok(!args.prompt.includes("一番近い骨組みの種類を family"), "family への指示は書かない");
  } finally {
    cleanup();
  }
});

void test("generateDirections に表現を渡すと、プロンプトに「## 表現」と面の名前・台帳の指示が入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const glass = surfaceOf("glass");
    const firstInstruction = glass.instructions[0];
    assert.ok(firstInstruction !== undefined, "glass の instructions が空です");
    await generateDirections(
      {
        brief: BRIEF,
        pageType: { name: "プラン比較" },
        fontPairs: FONT_PAIRS,
        treatment: { surface: "glass", motion: "animated", motionSamples: [] },
      },
      env,
    );
    const prompt = recordedArgs(dir).prompt;
    assert.ok(prompt.includes("## 表現"), "「## 表現」の節");
    assert.ok(prompt.includes(glass.name), "面の名前 (Glass)");
    assert.ok(prompt.includes(firstInstruction), "面の台帳の instructions の 1 つ目");
  } finally {
    cleanup();
  }
});

void test("treatment を省いたときと既定の表現のときの方向性のプロンプトは同じで、「## 表現」を含まない", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const input = { brief: BRIEF, pageType: { name: "プラン比較" }, fontPairs: FONT_PAIRS };
    await generateDirections(input, env);
    const omitted = recordedArgs(dir).prompt;
    await generateDirections({ ...input, treatment: { surface: "none", motion: "none", motionSamples: [] } }, env);
    const explicit = recordedArgs(dir).prompt;
    assert.equal(explicit, omitted, "プロンプトは 1 文字も変えない");
    assert.ok(!omitted.includes("## 表現"), "既定では「## 表現」を足さない");
  } finally {
    cleanup();
  }
});

void test("generatePage は検証を通った HTML を返し、テーマは cssForPage に差し替える", async () => {
  const { env, cleanup } = mockEnv("ok");
  try {
    const html = await generatePage(
      {
        brief: BRIEF,
        direction: MINIMAL,
        pageType: { name: "プラン比較", family: "pricing" },
        cssForPage: CSS_FOR_PAGE,
        fontsUrl: FONTS_URL,
      },
      env,
    );
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

void test("ページのプロンプトには画面の種類の名前と依頼の 4 項目、必ず入れる要素が入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    await generatePage(
      {
        brief: BRIEF,
        direction: MINIMAL,
        pageType: { name: "プラン比較", family: "pricing" },
        cssForPage: CSS_FOR_PAGE,
        fontsUrl: FONTS_URL,
      },
      env,
    );
    const args = recordedArgs(dir);
    assert.ok(args.prompt.includes("「プラン比較」のページ"), "画面の種類の名前");
    assert.ok(!args.prompt.includes("「pricing」のページ"), "family はページの名前として使わない");
    assert.ok(args.prompt.includes("layouts.pricing"), "配置の出発点は layouts.<family> の形");
    assert.ok(args.prompt.includes("### 作りたいもの\n請求書の SaaS を作りたい"), "依頼の 4 項目");
    assert.ok(args.prompt.includes("必ずページに入れて"), "入れたい要素があるときの指示");
    const outsideBrief = args.prompt.slice(args.prompt.indexOf("</user_brief>"));
    assert.ok(!outsideBrief.includes("PDF 出力"), "入れたい要素の本文は <user_brief> の外に書かない");
  } finally {
    cleanup();
  }
});

void test("ページに表現を渡すと、面の名前と、指定した見本 (css 付き) を必ず使う旨が入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const material = surfaceOf("material");
    const aurora = motionOf("aurora");
    await generatePage(pageInput({ surface: "material", motion: "animated", motionSamples: ["aurora"] }), env);
    const prompt = recordedArgs(dir).prompt;
    assert.ok(prompt.includes(material.name), "面の名前 (Material)");
    assert.ok(prompt.includes(aurora.name), "見本の名前 (aurora)");
    assert.ok(prompt.includes(aurora.css.slice(0, 20)), "見本の css の一部");
    assert.ok(prompt.includes("必ず使"), "指定した見本を必ず使う旨");
  } finally {
    cleanup();
  }
});

void test("ページの動きが subtle なら「0.3 秒」を含み、見本の css は入らない", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const aurora = motionOf("aurora");
    await generatePage(pageInput({ surface: "material", motion: "subtle", motionSamples: ["aurora"] }), env);
    const prompt = recordedArgs(dir).prompt;
    assert.ok(prompt.includes("0.3 秒"), "subtle の目安 (0.3 秒)");
    assert.ok(!prompt.includes(aurora.css.slice(0, 20)), "subtle では見本の css を入れない");
  } finally {
    cleanup();
  }
});

void test("ページのプロンプトには、表現の有無にかかわらず CSS の決まり (reduced-motion・color-mix・透明度・ぼかし) が入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const cases: (Treatment | undefined)[] = [undefined, { surface: "glass", motion: "animated", motionSamples: [] }];
    for (const treatment of cases) {
      await generatePage(pageInput(treatment), env);
      const prompt = recordedArgs(dir).prompt;
      for (const needle of ["prefers-reduced-motion", "color-mix", "bg-card/60", "backdrop-blur"]) {
        assert.ok(prompt.includes(needle), `${needle} がありません`);
      }
    }
  } finally {
    cleanup();
  }
});

void test("ページの動きが animated で見本の指定が無いときは、12 件すべてを候補として渡す", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const motions = loadMotions();
    await generatePage(pageInput({ surface: "glass", motion: "animated", motionSamples: [] }), env);
    const prompt = recordedArgs(dir).prompt;
    assert.equal(motions.length, 12, "動きの見本は 12 件");
    for (const motion of motions) {
      assert.ok(prompt.includes(motion.name), `候補の見本 ${motion.id} の名前がありません`);
    }
    assert.ok(prompt.includes("2〜4 件"), "2〜4 件を選ばせる");
  } finally {
    cleanup();
  }
});

void test("bad-then-good はページでも、1 回目の不正な出力のあとやり直して成功する", async () => {
  const { dir, env, cleanup } = mockEnv("bad-then-good");
  try {
    const html = await generatePage(
      { brief: BRIEF, direction: MINIMAL, pageType: { name: "LP", family: "lp" }, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL },
      env,
    );
    assert.deepEqual(findDisallowedUrls(html), []);
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("bad-page は LlmError (code bad-page)", async () => {
  const { env, cleanup } = mockEnv("bad-page");
  try {
    await assert.rejects(
      () =>
        generatePage(
          { brief: BRIEF, direction: MINIMAL, pageType: { name: "LP", family: "lp" }, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL },
          env,
        ),
      llmFailure("bad-page"),
    );
  } finally {
    cleanup();
  }
});

void test("no-csp (CSP の meta の無いページ) は LlmError (code bad-page)", async () => {
  const { env, cleanup } = mockEnv("no-csp");
  try {
    await assert.rejects(
      () =>
        generatePage(
          { brief: BRIEF, direction: MINIMAL, pageType: { name: "LP", family: "lp" }, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL },
          env,
        ),
      llmFailure("bad-page"),
    );
  } finally {
    cleanup();
  }
});

void test("motion-then-good は、reduced-motion の無いページのあとやり直して成功する", async () => {
  const { dir, env, cleanup } = mockEnv("motion-then-good");
  try {
    const html = await generatePage(pageInput({ surface: "glass", motion: "animated", motionSamples: [] }), env);
    assert.equal(checkMotion(html).ok, true, "返った HTML は動きの点検を通る");
    assert.equal(readFileSync(join(dir, "counter.txt"), "utf8"), "2", "2 回だけ呼ぶ");
  } finally {
    cleanup();
  }
});

void test("no-reduced-motion は LlmError (code bad-page) で、message に prefers-reduced-motion を含む", async () => {
  const { env, cleanup } = mockEnv("no-reduced-motion");
  try {
    await assert.rejects(
      () => generatePage(pageInput(), env),
      (e: unknown) => e instanceof LlmError && e.code === "bad-page" && e.message.includes("prefers-reduced-motion"),
    );
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

void test("htmlShapeLines は、ヒーローの要素に data-hero を 1 つだけ付ける行を含む", () => {
  const lines = htmlShapeLines(MINIMAL, FONTS_URL);
  const heroLines = lines.filter((line) => line.includes("data-hero"));
  assert.equal(heroLines.length, 1, "data-hero を含む行は 1 行");
  const heroLine = heroLines[0];
  assert.ok(heroLine !== undefined, "data-hero の行がある");
  assert.ok(heroLine.includes("ヒーロー"), "ヒーローの区画に付ける旨");
  assert.ok(heroLine.includes("1 つだけ"), "1 つだけ付ける旨");
  assert.ok(heroLine.includes("付けない"), "ヒーローが無い画面では付けない旨");
});

void test("スクリーンショットを渡すと、コピーした 1 ファイルだけを読める指定が引数に入る", async () => {
  const { dir, env, cleanup } = mockEnv("ok");
  try {
    const shot = join(dir, "mood.png");
    writeFileSync(shot, "not an image", "utf8");
    const { directions } = await generateDirections(
      { brief: BRIEF, pageType: { name: "LP" }, screenshotPath: shot, fontPairs: FONT_PAIRS },
      env,
    );
    assert.equal(directions.length, DIRECTION_IDS.length);
    const args = recordedArgs(dir);
    assert.equal(flagValue(args.argv, "--tools"), "Read");
    const addDir = args.addDir;
    assert.ok(typeof addDir === "string" && addDir !== dir, "参考画像の一時ディレクトリを指す");
    assert.deepEqual(args.addDirFiles, ["screenshot.png"], "コピーしたファイルだけが入っている");
  } finally {
    cleanup();
  }
});
