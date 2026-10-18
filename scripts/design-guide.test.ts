// design-guide サブコマンドと組み立て (core/design-guide-build.ts) を CLI の外から確かめる。
// style-guide は test/fixtures の偽物を使う。一時フォルダは os.tmpdir() の下に作り、終わったら消す
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DESIGN_GUIDE_FILE_NAMES, STYLE_GUIDE_UPDATE_NOTICE } from "../core/design-guide.ts";
import type { DesignGuideValues } from "../core/design-guide.ts";
import { PAGE_CSP } from "../core/page-html.ts";
import { findStyle } from "../core/styles.ts";
import { findMotion, findSurface } from "../core/treatment.ts";
import { COMPONENT_CANDIDATES } from "../core/types.ts";
import type { Direction } from "../core/types.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const FAKE_GUIDE = fileURLToPath(new URL("../test/fixtures/fake-style-guide", import.meta.url));
const FAKE_CSS = '@import "tailwindcss";\n:root { --fake-radius: 4px; }\n';
const TREATMENT_SAMPLES = ["spinning-border", "shimmer-text"];

// 部品帳の HTML。CSP の meta を先頭の要素側に置いた 1 ファイル
const SHEET_HTML = [
  "<!doctype html>",
  '<html lang="ja">',
  "<head>",
  '<meta charset="utf-8">',
  `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`,
  "<title>部品帳</title>",
  "</head>",
  "<body>",
  "<h1>部品帳</h1>",
  "</body>",
  "</html>",
  "",
].join("\n");

// 2.2 の決まりを満たす最小の値 (components は候補の順に 10 件)
const VALUES: DesignGuideValues = {
  tone: {
    words: {
      voice: "です・ます",
      style: "短い文で、語尾を「です・ます」にそろえる。",
      useWords: ["保存", "完了"],
      avoidWords: ["失敗", "バグ"],
      examples: [
        { situation: "保存ボタン", text: "保存する" },
        { situation: "通信エラー", text: "通信できませんでした。" },
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 偽 style-guide を STYLE_GUIDE_DIR に、使うなら FAKE_SG_MODE も足した env を返す
function fakeEnv(env: NodeJS.ProcessEnv, mode?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, STYLE_GUIDE_DIR: FAKE_GUIDE };
  if (mode !== undefined) out.FAKE_SG_MODE = mode;
  return out;
}

// 見本帳の minimal を方向性として使う
function minimalDirection(): Direction {
  const style = findStyle("minimal");
  assert.ok(style !== undefined, "見本帳に minimal がある");
  return style;
}

type Inputs = { direction: Direction; directionFile: string; sheetFile: string; valuesFile: string; out: string };

// 方向性・部品帳・値の入力ファイルを一時フォルダに書き、書き出し先も決める
function writeInputs(dir: string): Inputs {
  const direction = minimalDirection();
  const directionFile = join(dir, "direction.json");
  writeFileSync(directionFile, JSON.stringify(direction), "utf8");
  const sheetFile = join(dir, "sheet.html");
  writeFileSync(sheetFile, SHEET_HTML, "utf8");
  const valuesFile = join(dir, "values.json");
  writeFileSync(valuesFile, JSON.stringify(VALUES), "utf8");
  return { direction, directionFile, sheetFile, valuesFile, out: join(dir, "out") };
}

// --direction か --style minimal のどちらかで組み立てる引数
function argsOf(inputs: Inputs, source: "direction" | "style"): string[] {
  const sourceArgs = source === "direction" ? ["--direction", inputs.directionFile] : ["--style", "minimal"];
  return ["design-guide", ...sourceArgs, "--sheet", inputs.sheetFile, "--values", inputs.valuesFile, "--out", inputs.out];
}

// 書き出したフォルダのファイル名を並べる
function fileNamesIn(out: string): string[] {
  return readdirSync(out).sort();
}

void test("design-guide --direction は 5 ファイルを書き、決まった JSON を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const res = runCli(argsOf(inputs, "direction"), fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const body = payload(res.json);
    assert.equal(body.dir, resolve(inputs.out));
    assert.equal(body.styleGuide, "ok");
    assert.equal(body.notice, null);
    assert.deepEqual(body.files, [...DESIGN_GUIDE_FILE_NAMES]);
    assert.deepEqual(fileNamesIn(inputs.out), [...DESIGN_GUIDE_FILE_NAMES].sort());

    const expectedDoc = `# スタイルガイド (偽): ${inputs.direction.name}\n\n- id: ${inputs.direction.id}\n`;
    assert.equal(readFileSync(join(inputs.out, "style-guide.md"), "utf8"), expectedDoc, "style-guide.md は偽の文書そのまま");
    const guide = readFileSync(join(inputs.out, "design-guide.md"), "utf8");
    assert.ok(guide.startsWith(`# デザインガイド: ${inputs.direction.name}`), "design-guide.md の見出し");
    assert.ok(guide.includes("[style-guide.md](style-guide.md)"), "design-guide.md が style-guide.md を参照する");
    assert.equal(readFileSync(join(inputs.out, "component-sheet.html"), "utf8"), SHEET_HTML, "部品帳は渡した HTML そのまま");
    assert.equal(readFileSync(join(inputs.out, "theme.css"), "utf8"), FAKE_CSS, "theme.css は偽の css そのまま");
    const themes: unknown = JSON.parse(readFileSync(join(inputs.out, "theme.json"), "utf8"));
    assert.ok(Array.isArray(themes), "theme.json は配列");
    assert.deepEqual(themes, [{ id: inputs.direction.id, name: inputs.direction.name }]);
  } finally {
    cleanup();
  }
});

void test("design-guide --style minimal も 5 ファイルを書く", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const res = runCli(argsOf(inputs, "style"), fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(payload(res.json).files, [...DESIGN_GUIDE_FILE_NAMES]);
    assert.deepEqual(fileNamesIn(inputs.out), [...DESIGN_GUIDE_FILE_NAMES].sort());
    const guide = readFileSync(join(inputs.out, "design-guide.md"), "utf8");
    assert.ok(guide.startsWith(`# デザインガイド: ${inputs.direction.name}`), "design-guide.md の見出し");
  } finally {
    cleanup();
  }
});

void test("design-guide --treatment は面と見本の名前を設計ガイドの表現の節に入れる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const treatment = { surface: "glass", motion: "animated", motionSamples: TREATMENT_SAMPLES };
    const args = [...argsOf(inputs, "direction"), "--treatment", JSON.stringify(treatment)];
    const res = runCli(args, fakeEnv(env));
    assert.equal(res.code, 0, res.stderr);
    const guide = readFileSync(join(inputs.out, "design-guide.md"), "utf8");
    const start = guide.indexOf("## 表現");
    const end = guide.indexOf("## 部品");
    assert.ok(start !== -1 && end > start, "表現の節がある");
    const section = guide.slice(start, end);
    const surface = findSurface("glass");
    assert.ok(surface !== undefined, "glass が台帳にある");
    assert.ok(section.includes(`- 面: ${surface.name}`), "面の名前");
    const sampleNames = TREATMENT_SAMPLES.map((id) => {
      const motion = findMotion(id);
      assert.ok(motion !== undefined, `${id} が台帳にある`);
      return motion.name;
    });
    assert.ok(section.includes(`- 使った動きの見本: ${sampleNames.join("、")}`), "見本の名前");
  } finally {
    cleanup();
  }
});

void test("古い style-guide (no-doc) は 3 ファイルだけを書き、notice で知らせる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    mkdirSync(inputs.out, { recursive: true });
    for (const name of DESIGN_GUIDE_FILE_NAMES) writeFileSync(join(inputs.out, name), "古い中身", "utf8");
    writeFileSync(join(inputs.out, "note.txt"), "残す", "utf8");

    const res = runCli(argsOf(inputs, "direction"), fakeEnv(env, "no-doc"));
    assert.equal(res.code, 0, res.stderr);
    const body = payload(res.json);
    assert.equal(body.styleGuide, "outdated");
    assert.equal(body.notice, STYLE_GUIDE_UPDATE_NOTICE);
    assert.deepEqual(body.files, ["component-sheet.html", "theme.css", "theme.json"]);
    assert.deepEqual(fileNamesIn(inputs.out), ["component-sheet.html", "note.txt", "theme.css", "theme.json"]);
    assert.ok(!existsSync(join(inputs.out, "design-guide.md")), "design-guide.md は消える");
    assert.ok(!existsSync(join(inputs.out, "style-guide.md")), "style-guide.md は消える");
    assert.equal(readFileSync(join(inputs.out, "note.txt"), "utf8"), "残す", "ほかのファイルは残る");
    assert.equal(readFileSync(join(inputs.out, "component-sheet.html"), "utf8"), SHEET_HTML, "部品帳は書き直す");
    assert.equal(readFileSync(join(inputs.out, "theme.css"), "utf8"), FAKE_CSS, "theme.css は書き直す");
  } finally {
    cleanup();
  }
});

void test("古い style-guide (outdated) は終了コード 2 の style-guide-outdated", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const res = runCli(argsOf(inputs, "direction"), fakeEnv(env, "outdated"));
    assert.equal(res.code, 2);
    assert.equal(payload(res.json).error, "style-guide-outdated");
    assert.ok(!existsSync(inputs.out), "書き出さない");
  } finally {
    cleanup();
  }
});

void test("古い style-guide (outdated) でも CSP の無い部品帳は先に終了コード 1 の input", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const badSheet = join(dir, "bad-sheet.html");
    writeFileSync(badSheet, "<!doctype html><html><head><title>部品帳</title></head><body></body></html>", "utf8");
    const args = [
      "design-guide",
      "--direction",
      inputs.directionFile,
      "--sheet",
      badSheet,
      "--values",
      inputs.valuesFile,
      "--out",
      inputs.out,
    ];
    const res = runCli(args, fakeEnv(env, "outdated"));
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "input");
    assert.ok(!existsSync(inputs.out), "書き出さない");
  } finally {
    cleanup();
  }
});

void test("必須の引数と --direction / --style の指定は使い方の誤り", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const common = ["--sheet", inputs.sheetFile, "--values", inputs.valuesFile, "--out", inputs.out];
    const cases: { label: string; args: string[] }[] = [
      {
        label: "--sheet が無い",
        args: ["design-guide", "--direction", inputs.directionFile, "--values", inputs.valuesFile, "--out", inputs.out],
      },
      {
        label: "--direction と --style の両方",
        args: ["design-guide", "--direction", inputs.directionFile, "--style", "minimal", ...common],
      },
      { label: "どちらも無い", args: ["design-guide", ...common] },
    ];
    for (const { label, args } of cases) {
      const res = runCli(args, fakeEnv(env));
      assert.equal(res.code, 1, label);
      assert.equal(payload(res.json).error, "usage", label);
    }
  } finally {
    cleanup();
  }
});

void test("CSP の無い部品帳と決まりを満たさない values は終了コード 1 の input", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const inputs = writeInputs(dir);
    const fake = fakeEnv(env);
    const badSheet = join(dir, "bad-sheet.html");
    writeFileSync(badSheet, "<!doctype html><html><head><title>部品帳</title></head><body></body></html>", "utf8");
    const sheetArgs = [
      "design-guide",
      "--direction",
      inputs.directionFile,
      "--sheet",
      badSheet,
      "--values",
      inputs.valuesFile,
      "--out",
      inputs.out,
    ];
    const sheetRes = runCli(sheetArgs, fake);
    assert.equal(sheetRes.code, 1);
    assert.equal(payload(sheetRes.json).error, "input");

    const badValues = join(dir, "bad-values.json");
    writeFileSync(badValues, JSON.stringify({ tone: {}, components: [] }), "utf8");
    const valuesArgs = [
      "design-guide",
      "--direction",
      inputs.directionFile,
      "--sheet",
      inputs.sheetFile,
      "--values",
      badValues,
      "--out",
      inputs.out,
    ];
    const valuesRes = runCli(valuesArgs, fake);
    assert.equal(valuesRes.code, 1);
    assert.equal(payload(valuesRes.json).error, "input");
  } finally {
    cleanup();
  }
});
