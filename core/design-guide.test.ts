// デザインガイドの値・JSON Schema・文書・ファイル一式 (core/design-guide.ts) を外から確かめる。
// 一時フォルダは os.tmpdir() の下に作り、終わったら消す
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import {
  DESIGN_GUIDE_DIR,
  DESIGN_GUIDE_FILE_NAMES,
  DESIGN_GUIDE_KEY,
  DESIGN_GUIDE_NAME,
  DESIGN_GUIDE_VALUES_SCHEMA,
  STYLE_GUIDE_UPDATE_NOTICE,
  designGuideMarkdown,
  validateDesignGuideFiles,
  validateDesignGuideValues,
  writeDesignGuideFolder,
} from "./design-guide.ts";
import type { DesignGuideFileName, DesignGuideFile, DesignGuideValues } from "./design-guide.ts";
import { PAGE_CSP } from "./page-html.ts";
import { findMotion, findSurface } from "./treatment.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";
import type { Treatment } from "./types.ts";

// 決まりを満たす値 (2.2)。件数はすべて境界の内側
const VALUES: DesignGuideValues = {
  tone: {
    words: {
      voice: "です・ます",
      style: "短い文で、語尾は「です・ます」にそろえる。",
      useWords: ["保存", "完了"],
      avoidWords: ["バグ", "失敗"],
      examples: [
        { situation: "保存ボタン", text: "保存する" },
        { situation: "通信エラー", text: "通信できませんでした。もう一度お試しください。" },
      ],
    },
    visual: {
      keywords: ["落ち着き", "余白", "読みやすい"],
      treatmentUsage: ["カードの面は glass を使う"],
      avoid: ["強いグラデーション"],
    },
  },
  components: COMPONENT_CANDIDATES.map((candidate) => ({
    id: candidate.id,
    purpose: `${candidate.name}の用途`,
    states: "通常・ホバー・無効",
    whereToUse: "主要な操作",
    dont: "目立たせすぎない",
  })),
};

const DEFAULT_TREATMENT: Treatment = { surface: "none", motion: "none", motionSamples: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), "オブジェクト");
  return value;
}

function valuesJson(): Record<string, unknown> {
  const value: unknown = JSON.parse(JSON.stringify(VALUES));
  return record(value);
}

function wordsJson(json: Record<string, unknown>): Record<string, unknown> {
  return record(record(json.tone).words);
}

function visualJson(json: Record<string, unknown>): Record<string, unknown> {
  return record(record(json.tone).visual);
}

function inputErrorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CliExit, "CliExit で止まる");
    assert.equal(error.code, EXIT_INPUT);
    assert.equal(error.payload.error, "input");
    return error.message;
  }
  assert.fail("入力の誤りになりませんでした");
}

// 入力の誤り (終了コード 1 の input) で止まることを確かめる
function assertInputError(fn: () => unknown, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input", label);
}

function valuesErrorMessage(mutate: (json: Record<string, unknown>) => void): string {
  const json = valuesJson();
  mutate(json);
  return inputErrorMessage(() => validateDesignGuideValues(json));
}

function valuesWithExtraKeys(): Record<string, unknown> {
  const json = valuesJson();
  json.extra = true;
  const tone = record(json.tone);
  tone.extra = true;
  const words = wordsJson(json);
  words.extra = true;
  const visual = visualJson(json);
  visual.extra = true;
  record((words.examples as unknown[])[0]).extra = true;
  record((json.components as unknown[])[0]).extra = true;
  return json;
}

function valuesWithSpaces(): Record<string, unknown> {
  const json = valuesJson();
  const words = wordsJson(json);
  words.voice = `  ${VALUES.tone.words.voice}  `;
  words.style = `  ${VALUES.tone.words.style}  `;
  words.useWords = ["  保存  ", "  完了  "];
  words.avoidWords = ["  バグ  ", "  失敗  "];
  words.examples = VALUES.tone.words.examples.map((example) => ({
    situation: `  ${example.situation}  `,
    text: `  ${example.text}  `,
  }));
  const visual = visualJson(json);
  visual.keywords = VALUES.tone.visual.keywords.map((keyword) => `  ${keyword}  `);
  visual.treatmentUsage = VALUES.tone.visual.treatmentUsage.map((item) => `  ${item}  `);
  visual.avoid = VALUES.tone.visual.avoid.map((item) => `  ${item}  `);
  json.components = VALUES.components.map((component) => ({
    id: component.id,
    purpose: `  ${component.purpose}  `,
    states: `  ${component.states}  `,
    whereToUse: `  ${component.whereToUse}  `,
    dont: `  ${component.dont}  `,
  }));
  return json;
}

function markdownOf(treatment: Treatment, values: DesignGuideValues = VALUES): string {
  return designGuideMarkdown({ directionName: "静かな料金ページ", treatment, values });
}

function lineOf(md: string, prefix: string): string {
  const found = md.split("\n").find((line) => line.startsWith(prefix));
  assert.ok(found !== undefined, `${prefix} で始まる行がある`);
  return found;
}

// CSP の meta を持つ部品帳の HTML (core/page-html.ts の PAGE_CSP から組む)
const SHEET_HTML = [
  "<!doctype html>",
  '<html lang="ja">',
  "<head>",
  '<meta charset="utf-8">',
  `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`,
  "<title>部品帳</title>",
  "</head>",
  "<body></body>",
  "</html>",
  "",
].join("\n");

const FIVE_FILES: DesignGuideFile[] = [
  { name: "design-guide.md", content: "# デザインガイド\n" },
  { name: "style-guide.md", content: "# スタイルガイド\n" },
  { name: "component-sheet.html", content: SHEET_HTML },
  { name: "theme.css", content: "/* theme */\n" },
  { name: "theme.json", content: "{}\n" },
];

const THREE_FILES: DesignGuideFile[] = FIVE_FILES.filter((file) => file.name !== "design-guide.md" && file.name !== "style-guide.md");

function filesWithout(name: DesignGuideFileName): unknown[] {
  return FIVE_FILES.filter((file) => file.name !== name).map((file) => ({ name: file.name, content: file.content }));
}

// 1 つのファイルだけ中身を差し替えた並び
function filesWithContent(name: DesignGuideFileName, content: unknown): unknown[] {
  return FIVE_FILES.map((file) => ({ name: file.name, content: file.name === name ? content : file.content }));
}

void test("定数は contract.md の 2.1 節のとおり", () => {
  assert.equal(DESIGN_GUIDE_KEY, "design-guide");
  assert.equal(DESIGN_GUIDE_NAME, "デザインガイド");
  assert.equal(DESIGN_GUIDE_DIR, "design-guide");
  assert.equal(STYLE_GUIDE_UPDATE_NOTICE, "style-guide を更新するとデザインガイドも作れます");
  assert.deepEqual([...DESIGN_GUIDE_FILE_NAMES], ["design-guide.md", "style-guide.md", "component-sheet.html", "theme.css", "theme.json"]);
});

void test("validateDesignGuideValues は決まりを満たす値を受け、文字列を trim して余分なキーを落とす", () => {
  assert.deepEqual(validateDesignGuideValues(valuesJson()), VALUES);
  assert.deepEqual(validateDesignGuideValues(valuesWithSpaces()), VALUES);
  assert.deepEqual(validateDesignGuideValues(valuesWithExtraKeys()), VALUES);
  const mixed = valuesWithSpaces();
  mixed.extra = true;
  record(record(mixed.tone).words).extra = true;
  assert.deepEqual(validateDesignGuideValues(mixed), VALUES);
});

void test("keywords が 3〜5 件の外なら tone.visual.keywords の誤り", () => {
  for (const count of [2, 6]) {
    const message = valuesErrorMessage((json) => {
      visualJson(json).keywords = Array.from({ length: count }, (_, index) => `キーワード${index}`);
    });
    assert.match(message, /tone\.visual\.keywords/, `${count} 件`);
  }
});

void test("components が 10 件でなければ components の誤り", () => {
  const message = valuesErrorMessage((json) => {
    json.components = (json.components as unknown[]).slice(0, 9);
  });
  assert.match(message, /components/);
});

void test("components の id の並びが候補の順と違えば components[i].id の誤り", () => {
  const message = valuesErrorMessage((json) => {
    const components = json.components as Record<string, unknown>[];
    const first = components[0];
    const second = components[1];
    assert.ok(first !== undefined && second !== undefined);
    components[0] = second;
    components[1] = first;
  });
  assert.match(message, /components\[0\]\.id/);
});

void test("文字列に改行を含むと、その場所の誤り", () => {
  const message = valuesErrorMessage((json) => {
    wordsJson(json).style = "1 行目\n2 行目";
  });
  assert.match(message, /tone\.words\.style/);
});

void test("voice が 81 文字なら tone.words.voice の誤り (80 文字は通る)", () => {
  const message = valuesErrorMessage((json) => {
    wordsJson(json).voice = "あ".repeat(81);
  });
  assert.match(message, /tone\.words\.voice/);
  const json = valuesJson();
  wordsJson(json).voice = "あ".repeat(80);
  assert.equal(validateDesignGuideValues(json).tone.words.voice, "あ".repeat(80));
});

void test("useWords が空の配列なら tone.words.useWords の誤り", () => {
  const message = valuesErrorMessage((json) => {
    wordsJson(json).useWords = [];
  });
  assert.match(message, /tone\.words\.useWords/);
});

void test("tone が無ければ tone の誤り", () => {
  const message = valuesErrorMessage((json) => {
    delete json.tone;
  });
  assert.match(message, /tone/);
});

void test("値がオブジェクトでなければ入力の誤り", () => {
  for (const value of [null, [], "guide", 1, true]) {
    assertInputError(() => validateDesignGuideValues(value), JSON.stringify(value));
  }
});

void test("DESIGN_GUIDE_VALUES_SCHEMA はオブジェクトで、components は 10 件ちょうど", () => {
  assert.equal(typeof DESIGN_GUIDE_VALUES_SCHEMA, "object");
  assert.ok(!Array.isArray(DESIGN_GUIDE_VALUES_SCHEMA));
  const schema = record(DESIGN_GUIDE_VALUES_SCHEMA);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  const components = record(record(schema.properties).components);
  assert.equal(components.type, "array");
  assert.equal(components.minItems, 10);
  assert.equal(components.maxItems, 10);
});

void test("designGuideMarkdown の見出しは 2.3 節の順と文字のとおりで、同じ入力から同じ文字列", () => {
  const md = markdownOf(DEFAULT_TREATMENT);
  const headings = md.split("\n").filter((line) => line.startsWith("#"));
  assert.deepEqual(headings, [
    "# デザインガイド: 静かな料金ページ",
    "## トンマナ",
    "### 言葉",
    "#### 文言の例",
    "### 見た目",
    "#### 表現の使いどころ",
    "#### 避けること",
    "## 表現",
    "## 部品",
    ...COMPONENT_CANDIDATES.map((candidate) => `### ${candidate.name}`),
    "## 参照",
  ]);
  assert.ok(md.includes("### 言葉\n\n- 口調: "), "見出しと本文のあいだは空行 1 つ");
  assert.equal(markdownOf(DEFAULT_TREATMENT, structuredClone(VALUES)), md, "同じ入力から同じ文字列");
  assert.ok(md.endsWith("\n"));
  assert.ok(!md.endsWith("\n\n"), "末尾は改行 1 つ");
});

void test("designGuideMarkdown は節と節・見出しと本文のあいだに空行を 1 つ入れる", () => {
  const md = markdownOf(DEFAULT_TREATMENT);
  assert.ok(md.includes("## 部品\n\n### ボタン\n\n- 用途: "), "## 部品 と最初の部品のあいだは空行 1 つ");
  assert.ok(!md.includes("\n\n\n"), "空行が 2 つ続く所は無い");
});

void test("表のセルの | は \\| になり、面と動きと見本の名前は台帳の名前になる", () => {
  const values = structuredClone(VALUES);
  values.tone.words.examples[0] = { situation: "保存|ボタン", text: "a|b" };
  const md = markdownOf({ surface: "glass", motion: "none", motionSamples: [] }, values);
  assert.ok(md.includes("| 保存\\|ボタン | a\\|b |"));

  const glass = findSurface("glass");
  assert.ok(glass !== undefined);
  assert.equal(lineOf(md, "- 面: "), `- 面: ${glass.name}`);
  assert.equal(lineOf(md, "- 動き: "), "- 動き: なし");
  assert.equal(lineOf(md, "- 使った動きの見本: "), "- 使った動きの見本: なし");
});

void test("動きが animated の見本は台帳の名前、0 件は指定なし、subtle は控えめ", () => {
  const first = findMotion("aurora");
  const second = findMotion("spinning-border");
  assert.ok(first !== undefined && second !== undefined);
  const animated = markdownOf({ surface: "none", motion: "animated", motionSamples: ["aurora", "spinning-border"] });
  assert.equal(lineOf(animated, "- 動き: "), "- 動き: Animated");
  assert.equal(lineOf(animated, "- 使った動きの見本: "), `- 使った動きの見本: ${first.name}、${second.name}`);

  const noSample = markdownOf({ surface: "none", motion: "animated", motionSamples: [] });
  assert.equal(lineOf(noSample, "- 使った動きの見本: "), "- 使った動きの見本: 指定なし (部品帳の中で AI が選んだもの)");

  const subtle = markdownOf({ surface: "none", motion: "subtle", motionSamples: [] });
  assert.equal(lineOf(subtle, "- 動き: "), "- 動き: 控えめ");
  assert.equal(lineOf(subtle, "- 使った動きの見本: "), "- 使った動きの見本: なし");
});

void test("参照の節に 3 つのファイルのリンクがある", () => {
  const md = markdownOf(DEFAULT_TREATMENT);
  assert.ok(md.includes("[style-guide.md](style-guide.md)"));
  assert.ok(md.includes("[component-sheet.html](component-sheet.html)"));
  assert.ok(md.includes("[theme.css](theme.css)"));
  assert.ok(md.includes("[theme.json](theme.json)"));
});

void test("validateDesignGuideFiles は 5 ファイルと 3 ファイルを受け、DESIGN_GUIDE_FILE_NAMES の順に並べる", () => {
  const shuffled = validateDesignGuideFiles([
    { name: "theme.json", content: "{}\n" },
    { name: "component-sheet.html", content: SHEET_HTML },
    { name: "design-guide.md", content: "# デザインガイド\n" },
    { name: "style-guide.md", content: "# スタイルガイド\n" },
    { name: "theme.css", content: "/* theme */\n" },
  ]);
  assert.deepEqual(
    shuffled.map((file) => file.name),
    [...DESIGN_GUIDE_FILE_NAMES],
  );
  assert.deepEqual(shuffled, FIVE_FILES);

  const three = validateDesignGuideFiles(THREE_FILES.map((file) => ({ name: file.name, content: file.content })));
  assert.deepEqual(
    three.map((file) => file.name),
    ["component-sheet.html", "theme.css", "theme.json"],
  );
  assert.deepEqual(three, THREE_FILES);
});

void test("validateDesignGuideFiles は欠け・片方だけ・重複・知らない名前・CSP 無し・文字列でない content を誤りにする", () => {
  const cases: { label: string; files: unknown[]; pattern: RegExp }[] = [
    { label: "theme.css が無い", files: filesWithout("theme.css"), pattern: /theme\.css/ },
    { label: "style-guide.md だけ無い", files: filesWithout("style-guide.md"), pattern: /style-guide\.md/ },
    { label: "design-guide.md だけ無い", files: filesWithout("design-guide.md"), pattern: /design-guide\.md/ },
    {
      label: "同じ名前が 2 回",
      files: [...FIVE_FILES, { name: "design-guide.md", content: "# もう 1 つ\n" }],
      pattern: /design-guide\.md/,
    },
    { label: "知らない名前", files: [...FIVE_FILES, { name: "notes.txt", content: "x" }], pattern: /files\[5\]\.name/ },
    {
      label: "component-sheet.html に CSP の meta が無い",
      files: filesWithContent("component-sheet.html", "<!doctype html><html><head></head><body></body></html>"),
      pattern: /component-sheet\.html/,
    },
    { label: "content が文字列でない", files: filesWithContent("theme.css", 1), pattern: /content/ },
  ];
  for (const c of cases) assertInputError(() => validateDesignGuideFiles(c.files), c.label);
});

void test("writeDesignGuideFolder はフォルダを作って書き、3 ファイルで書き直すと古い md だけ消してほかを残す", () => {
  const base = mkdtempSync(join(tmpdir(), "design-guide-"));
  try {
    const dir = join(base, "out", "design-guide");
    const written = writeDesignGuideFolder(dir, FIVE_FILES);
    assert.equal(written, resolve(dir));
    assert.ok(existsSync(dir), "無いフォルダを作る");
    for (const file of FIVE_FILES) {
      assert.equal(readFileSync(join(written, file.name), "utf8"), file.content, file.name);
    }

    writeFileSync(join(written, "notes.txt"), "残す\n", "utf8");
    writeDesignGuideFolder(written, THREE_FILES);
    assert.equal(existsSync(join(written, "design-guide.md")), false);
    assert.equal(existsSync(join(written, "style-guide.md")), false);
    assert.equal(readFileSync(join(written, "notes.txt"), "utf8"), "残す\n", "ほかのファイルは残る");
    for (const file of THREE_FILES) {
      assert.equal(readFileSync(join(written, file.name), "utf8"), file.content, file.name);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
