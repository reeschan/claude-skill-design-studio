// project サブコマンドと core/project.ts を CLI の外から確かめる。home は一時ディレクトリ。
// 保存の形は版 3 (依頼・回の履歴・点・微調整・表現・保存した 1 件ごとの item)。版 2 と版の無い古い形は読むときに直る
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyFineTune } from "../core/direction.ts";
import { DESIGN_GUIDE_FILE_NAMES } from "../core/design-guide.ts";
import { PAGE_CSP } from "../core/page-html.ts";
import { readComponent, readPage } from "../core/project.ts";
import { findStyle } from "../core/styles.ts";
import type { Direction } from "../core/types.ts";
import { runCli, tempEnv } from "./test-helper.ts";

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
// 2 つ目の案 (回の 2 つ目の案や 2 つ目の回に使う)
const DIRECTION_B: Direction = { ...DIRECTION, id: "alt", name: "別案", seed: { ...DIRECTION.seed, id: "alt" } };
// 編集後の案 (微調整を重ねたもの)
const EDITED_B = applyFineTune(DIRECTION_B, { baseMode: "dark" });

// パッドの点。4 軸とも A の隅 (0, 0)
const POINT_A = { x: 0, y: 0 };
const POINTS_A = { color: POINT_A, font: POINT_A, shape: POINT_A, layout: POINT_A };

// 表現の既定 (版 2 や古い形から直したときに入る)
const DEFAULT_TREATMENT_JSON = { surface: "none", motion: "none", motionSamples: [] };
// 表現の例 (面と動きの見本を選んだもの)
const GLASS_TREATMENT = { surface: "glass", motion: "animated", motionSamples: ["aurora"] };
const SOLID_TREATMENT = { surface: "solid", motion: "none", motionSamples: [] };

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

// デザインガイドのフォルダに置くファイルと、その短い中身
const GUIDE_CONTENTS: Record<string, string> = {
  "design-guide.md": "# デザインガイド: LP\n",
  "style-guide.md": "# スタイルガイド\n",
  "component-sheet.html": SHEET_HTML,
  "theme.css": ":root { --color-primary: oklch(0.5 0.15 260); }\n",
  "theme.json": "[]\n",
};

// 依頼。what 以外は空
function briefJson(what: string): Record<string, string> {
  return { what, mood: "", audience: "", mustHave: "" };
}

// 版 2 の project.json の中身 (createdAt・updatedAt は保存する側が決める)
function newProjectJson(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    id,
    brief: briefJson("落ち着いた LP を作る"),
    pageType: { name: "LP", family: "lp" },
    rounds: [{ drafts: [DIRECTION], edits: [null] }],
    roundIndex: 0,
    points: POINTS_A,
    fineTune: {},
    pages: [],
    ...overrides,
  };
}

// 版 3 の project.json の中身 (createdAt・updatedAt は保存する側が決める)
function projectJsonV3(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id,
    brief: briefJson("落ち着いた LP を作る"),
    pageType: { name: "LP", family: "lp" },
    treatment: DEFAULT_TREATMENT_JSON,
    rounds: [{ drafts: [DIRECTION], edits: [null] }],
    roundIndex: 0,
    points: POINTS_A,
    fineTune: {},
    items: [],
    background: null,
    ...overrides,
  };
}

// 版が無い古い形の project.json。direction の layouts は 3 種類だけ
function oldProjectJson(id: string): Record<string, unknown> {
  const layouts = { lp: DIRECTION.layouts.lp, dashboard: DIRECTION.layouts.dashboard, blog: DIRECTION.layouts.blog };
  return {
    id,
    prompt: "古い依頼",
    pageType: "lp",
    direction: {
      id: DIRECTION.id,
      name: DIRECTION.name,
      rationale: DIRECTION.rationale,
      seed: DIRECTION.seed,
      layouts,
      copy: DIRECTION.copy,
    },
    pages: ["lp"],
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
  };
}

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

// 応答の配列をオブジェクトの配列として読む
function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} が配列ではありません: ${JSON.stringify(value)}`);
  return value.map((item) => record(item, label));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 値を JSON ファイルとして書く
function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

// デザインガイドのフォルダを dir の下に作り、names のファイルだけを置く
function writeGuideFolder(dir: string, names: string[]): string {
  const folder = join(dir, "guide-source");
  mkdirSync(folder, { recursive: true });
  for (const name of names) writeFileSync(join(folder, name), GUIDE_CONTENTS[name] ?? "", "utf8");
  return folder;
}

// tempEnv が向けた home
function homeOf(env: NodeJS.ProcessEnv): string {
  const home = env.DESIGN_STUDIO_HOME;
  if (home === undefined) throw new Error("DESIGN_STUDIO_HOME がありません");
  return home;
}

// 応答の project
function projectOf(json: unknown): Record<string, unknown> {
  return record(payload(json).project, "project");
}

// createdAt・updatedAt を外した写し
function withoutTimes(project: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (key !== "createdAt" && key !== "updatedAt") copy[key] = value;
  }
  return copy;
}

void test("save は project.json・theme.css・pages/<key>.html を書き、show が同じ内容を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectFile = writeJson(dir, "project.json", newProjectJson("hello"));
    const themeCss = ":root { --color-primary: oklch(0.5 0.15 260); }\n";
    const themeCssFile = join(dir, "source-theme.css");
    writeFileSync(themeCssFile, themeCss, "utf8");
    const html = '<!doctype html><html lang="ja"><body>こんにちは</body></html>\n';
    const htmlFile = join(dir, "source-page.html");
    writeFileSync(htmlFile, html, "utf8");

    const res = runCli(
      ["project", "save", "--project", projectFile, "--theme-css", themeCssFile, "--page-name", "LP", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    const projectDir = join(homeOf(env), "projects", "hello");
    assert.equal(payload(res.json).dir, projectDir);

    assert.deepEqual(JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8")), saved);
    assert.equal(readFileSync(join(projectDir, "theme.css"), "utf8"), themeCss);
    assert.equal(readFileSync(join(projectDir, "pages", "lp.html"), "utf8"), html);
    assert.equal(saved.version, 3);
    assert.deepEqual(saved.pageType, { name: "LP", family: "lp" });
    assert.deepEqual(saved.treatment, DEFAULT_TREATMENT_JSON);
    assert.deepEqual(saved.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT_JSON }]);
    assert.equal(readFileSync(projectFile, "utf8").includes("createdAt"), false, "入力のファイルは変えない");

    // show は同じ内容と dir を返す
    const show = runCli(["project", "show", "hello"], env);
    assert.equal(show.code, 0, show.stderr);
    assert.deepEqual(projectOf(show.json), saved);
    assert.equal(payload(show.json).dir, projectDir);

    // 時刻は ISO 8601
    for (const key of ["createdAt", "updatedAt"]) {
      const value = saved[key];
      assert.equal(typeof value, "string", `${key} は文字列`);
      assert.equal(new Date(String(value)).toISOString(), value, `${key} は ISO 8601`);
    }
  } finally {
    cleanup();
  }
});

void test("ページ付きの save を 2 回すると items が重複なく積まれ、createdAt はそのまま・updatedAt は進む", async () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectDir = join(homeOf(env), "projects", "twice");
    const pricingHtml = "<!doctype html><title>pricing</title>\n";
    const pricingFile = join(dir, "pricing.html");
    writeFileSync(pricingFile, pricingHtml, "utf8");
    const first = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "first.json", newProjectJson("twice")),
        "--page-name",
        "料金ページ",
        "--html",
        pricingFile,
      ],
      env,
    );
    assert.equal(first.code, 0, first.stderr);
    const firstProject = projectOf(first.json);
    assert.deepEqual(firstProject.items, [
      { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT_JSON },
    ]);

    await sleep(15);

    const blogHtml = "<!doctype html><title>blog</title>\n";
    const blogFile = join(dir, "blog.html");
    writeFileSync(blogFile, blogHtml, "utf8");
    const secondInput = newProjectJson("twice", { brief: briefJson("料金とブログを作る") });
    const second = runCli(
      ["project", "save", "--project", writeJson(dir, "second.json", secondInput), "--page-name", "ブログ記事", "--html", blogFile],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    const secondProject = projectOf(second.json);

    assert.deepEqual(secondProject.items, [
      { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT_JSON },
      { kind: "page", key: "blog", name: "ブログ記事", family: "blog", treatment: DEFAULT_TREATMENT_JSON },
    ]);
    assert.equal(record(secondProject.brief, "brief").what, "料金とブログを作る");
    assert.equal(secondProject.createdAt, firstProject.createdAt);
    assert.ok(String(secondProject.updatedAt) > String(firstProject.updatedAt), "updatedAt は進む");
    assert.equal(readFileSync(join(projectDir, "pages", "pricing.html"), "utf8"), pricingHtml);
    assert.equal(readFileSync(join(projectDir, "pages", "blog.html"), "utf8"), blogHtml);
  } finally {
    cleanup();
  }
});

void test("入力の project の items は積まず、今回のページだけを積む", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const input = projectJsonV3("nopage", {
      items: [{ kind: "page", key: "dashboard", name: "ダッシュボード", family: "dashboard", treatment: DEFAULT_TREATMENT_JSON }],
    });
    const res = runCli(["project", "save", "--project", writeJson(dir, "nopage.json", input)], env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(projectOf(res.json).items, [], "html を書いていないページは items に入らない");
    assert.equal(readPage(env, "nopage", "dashboard"), null);
  } finally {
    cleanup();
  }
});

void test("版 3 を保存して読み戻すと、createdAt・updatedAt 以外は同じ", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const input = projectJsonV3("v3", {
      brief: briefJson("料金と設定を作る"),
      pageType: { name: "プラン比較", family: "pricing" },
      treatment: GLASS_TREATMENT,
      rounds: [
        { drafts: [DIRECTION, DIRECTION_B], edits: [null, EDITED_B] },
        { drafts: [DIRECTION_B], edits: [null] },
      ],
      roundIndex: 1,
      points: { color: { x: 0.5, y: 0 }, font: { x: 0, y: 1 }, shape: { x: 1, y: 0.25 }, layout: { x: 0.333, y: 0.75 } },
      fineTune: { radiusPx: 4, baseMode: "dark", layouts: { pricing: "table" } },
    });

    const res = runCli(["project", "save", "--project", writeJson(dir, "v3.json", input)], env);
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    assert.deepEqual(withoutTimes(saved), input);

    for (const key of ["createdAt", "updatedAt"]) {
      const value = saved[key];
      assert.equal(typeof value, "string", `${key} は文字列`);
      assert.equal(new Date(String(value)).toISOString(), value, `${key} は ISO 8601`);
    }

    const show = runCli(["project", "show", "v3"], env);
    assert.equal(show.code, 0, show.stderr);
    assert.deepEqual(projectOf(show.json), saved);
  } finally {
    cleanup();
  }
});

void test("版 3 の treatment は project と item に残り、show で読み戻せる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const htmlFile = join(dir, "lp.html");
    writeFileSync(htmlFile, "<!doctype html><title>LP</title>\n", "utf8");
    const input = projectJsonV3("treated", { treatment: GLASS_TREATMENT });
    const res = runCli(
      ["project", "save", "--project", writeJson(dir, "treated.json", input), "--page-name", "LP", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    assert.equal(saved.version, 3);
    assert.deepEqual(saved.treatment, GLASS_TREATMENT);
    assert.deepEqual(saved.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: GLASS_TREATMENT }]);

    const show = runCli(["project", "show", "treated"], env);
    assert.equal(show.code, 0, show.stderr);
    assert.deepEqual(projectOf(show.json), saved);
  } finally {
    cleanup();
  }
});

void test("同じ画面の種類で保存し直すと item は 1 件で treatment が新しくなり、別の画面の種類なら 1 件目の treatment は前のまま", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const lpHtml = "<!doctype html><title>LP</title>\n";
    const lpHtmlFile = join(dir, "lp.html");
    writeFileSync(lpHtmlFile, lpHtml, "utf8");
    const pricingHtml = "<!doctype html><title>料金</title>\n";
    const pricingHtmlFile = join(dir, "pricing.html");
    writeFileSync(pricingHtmlFile, pricingHtml, "utf8");

    // 1 回目は glass
    const first = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "first.json", projectJsonV3("retreat", { treatment: GLASS_TREATMENT })),
        "--page-name",
        "LP",
        "--html",
        lpHtmlFile,
      ],
      env,
    );
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(projectOf(first.json).items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: GLASS_TREATMENT }]);

    // 同じ画面の種類で solid に変えると、item は 1 件のまま treatment が新しくなる
    const second = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "second.json", projectJsonV3("retreat", { treatment: SOLID_TREATMENT })),
        "--page-name",
        "LP",
        "--html",
        lpHtmlFile,
      ],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    const secondProject = projectOf(second.json);
    assert.deepEqual(secondProject.treatment, SOLID_TREATMENT);
    assert.deepEqual(secondProject.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: SOLID_TREATMENT }]);

    // 別の画面の種類を glass で保存すると item が 2 件になり、1 件目は前の treatment のまま
    const third = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "third.json", projectJsonV3("retreat", { treatment: GLASS_TREATMENT })),
        "--page-name",
        "料金ページ",
        "--html",
        pricingHtmlFile,
      ],
      env,
    );
    assert.equal(third.code, 0, third.stderr);
    const thirdProject = projectOf(third.json);
    assert.deepEqual(thirdProject.treatment, GLASS_TREATMENT);
    assert.deepEqual(thirdProject.items, [
      { kind: "page", key: "lp", name: "LP", family: "lp", treatment: SOLID_TREATMENT },
      { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: GLASS_TREATMENT },
    ]);
    assert.equal(readPage(env, "retreat", "lp"), lpHtml);
    assert.equal(readPage(env, "retreat", "pricing"), pricingHtml);
  } finally {
    cleanup();
  }
});

void test("版 2 の project.json は show で版 3 に直り、版 2 の入力の save も版 3 で保存する", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectDir = join(homeOf(env), "projects", "v2read");
    mkdirSync(projectDir, { recursive: true });
    const stored = newProjectJson("v2read", {
      pages: [
        { key: "pricing", name: "料金ページ", family: "pricing" },
        { key: "dashboard", name: "ダッシュボード", family: "dashboard" },
      ],
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
    writeFileSync(join(projectDir, "project.json"), JSON.stringify(stored), "utf8");

    const show = runCli(["project", "show", "v2read"], env);
    assert.equal(show.code, 0, show.stderr);
    const project = projectOf(show.json);
    assert.equal(project.version, 3);
    assert.deepEqual(project.treatment, DEFAULT_TREATMENT_JSON);
    assert.deepEqual(project.items, [
      { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT_JSON },
      { kind: "page", key: "dashboard", name: "ダッシュボード", family: "dashboard", treatment: DEFAULT_TREATMENT_JSON },
    ]);

    // 版 2 の入力を save に渡しても版 3 で保存される
    const res = runCli(["project", "save", "--project", writeJson(dir, "v2.json", newProjectJson("v2save"))], env);
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    assert.equal(saved.version, 3);
    assert.deepEqual(saved.treatment, DEFAULT_TREATMENT_JSON);
    assert.deepEqual(saved.items, []);
    assert.deepEqual(projectOf(runCli(["project", "show", "v2save"], env).json), saved);
  } finally {
    cleanup();
  }
});

void test("版の無い古い形の project.json は読むと新しい形に直り、前のページも読める", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectDir = join(homeOf(env), "projects", "old");
    mkdirSync(join(projectDir, "pages"), { recursive: true });
    writeFileSync(join(projectDir, "project.json"), JSON.stringify(oldProjectJson("old")), "utf8");
    const html = "<!doctype html><title>古いページ</title>\n";
    writeFileSync(join(projectDir, "pages", "lp.html"), html, "utf8");

    const show = runCli(["project", "show", "old"], env);
    assert.equal(show.code, 0, show.stderr);
    const project = projectOf(show.json);
    assert.equal(project.version, 3);
    assert.deepEqual(project.brief, briefJson("古い依頼"));
    assert.deepEqual(project.pageType, { name: "LP", family: "lp" });
    const rounds = records(project.rounds, "rounds");
    assert.equal(rounds.length, 1, "回は 1 つ");
    const drafts = records(rounds[0]?.drafts, "drafts");
    assert.equal(drafts.length, 1, "原案は 1 つだけ");
    assert.deepEqual(rounds[0]?.edits, [null]);
    assert.equal(drafts[0]?.id, DIRECTION.id);
    assert.equal(drafts[0]?.name, DIRECTION.name);
    assert.equal(project.roundIndex, 0);
    assert.deepEqual(project.points, POINTS_A);
    assert.deepEqual(project.fineTune, {});
    assert.deepEqual(project.treatment, DEFAULT_TREATMENT_JSON);
    assert.deepEqual(project.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT_JSON }]);
    assert.equal(project.createdAt, "2026-01-02T03:04:05.000Z");
    assert.equal(project.updatedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(readPage(env, "old", "lp"), html);

    // list の要約も新しい形になる
    const listed = records(payload(runCli(["project", "list"], env).json).projects, "projects");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.what, "古い依頼");
    assert.deepEqual(listed[0]?.pageType, { name: "LP", family: "lp" });
    assert.equal(listed[0]?.name, DIRECTION.name);
    assert.deepEqual(listed[0]?.items, project.items);
  } finally {
    cleanup();
  }
});

void test("同じ骨組みに当たる 2 つの画面の種類のページは別々のキーで保存される", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const pricingHtml = "<!doctype html><title>料金</title>\n";
    const pricingFile = join(dir, "pricing.html");
    writeFileSync(pricingFile, pricingHtml, "utf8");
    const compareHtml = "<!doctype html><title>比較</title>\n";
    const compareFile = join(dir, "compare.html");
    writeFileSync(compareFile, compareHtml, "utf8");

    const first = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "p1.json", newProjectJson("same-family")),
        "--page-name",
        "料金ページ",
        "--html",
        pricingFile,
      ],
      env,
    );
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(projectOf(first.json).items, [
      { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT_JSON },
    ]);

    const second = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "p2.json", newProjectJson("same-family")),
        "--page-name",
        "プラン比較",
        "--family",
        "pricing",
        "--html",
        compareFile,
      ],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    const items = records(projectOf(second.json).items, "items");
    assert.equal(items.length, 2, "同じ骨組みでも別々に積まれる");
    assert.deepEqual(items[0], {
      kind: "page",
      key: "pricing",
      name: "料金ページ",
      family: "pricing",
      treatment: DEFAULT_TREATMENT_JSON,
    });
    const key = items[1]?.key;
    assert.equal(typeof key, "string");
    assert.notEqual(key, "pricing", "キーは候補の名前のものと違う");
    assert.match(String(key), /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.deepEqual(items[1], {
      kind: "page",
      key,
      name: "プラン比較",
      family: "pricing",
      treatment: DEFAULT_TREATMENT_JSON,
    });

    // どちらの HTML も別々に読める
    assert.equal(readPage(env, "same-family", "pricing"), pricingHtml);
    assert.equal(readPage(env, "same-family", String(key)), compareHtml);
  } finally {
    cleanup();
  }
});

void test("同じ画面の種類で 2 回保存すると items は 1 件のままで HTML は新しいもの", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const firstHtml = "<!doctype html><title>料金 (古い)</title>\n";
    const firstFile = join(dir, "pricing-1.html");
    writeFileSync(firstFile, firstHtml, "utf8");
    const first = runCli(
      ["project", "save", "--project", writeJson(dir, "p1.json", newProjectJson("same")), "--page-name", "料金ページ", "--html", firstFile],
      env,
    );
    assert.equal(first.code, 0, first.stderr);

    const secondHtml = "<!doctype html><title>料金 (新しい)</title>\n";
    const secondFile = join(dir, "pricing-2.html");
    writeFileSync(secondFile, secondHtml, "utf8");
    // 候補の名前でも family は明示できる (同じ値のとき)
    const second = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "p2.json", newProjectJson("same")),
        "--page-name",
        "料金ページ",
        "--family",
        "pricing",
        "--html",
        secondFile,
      ],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(
      projectOf(second.json).items,
      [{ kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT_JSON }],
      "items は 1 件のまま",
    );
    assert.equal(readPage(env, "same", "pricing"), secondHtml, "HTML は新しいもの");
  } finally {
    cleanup();
  }
});

void test("自由な名前のページは family を選び直しても同じキーで、items の family が新しくなる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const firstHtml = "<!doctype html><title>比較 (料金)</title>\n";
    const firstFile = join(dir, "plan-1.html");
    writeFileSync(firstFile, firstHtml, "utf8");
    const first = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "p1.json", newProjectJson("plan")),
        "--page-name",
        "プラン比較",
        "--family",
        "pricing",
        "--html",
        firstFile,
      ],
      env,
    );
    assert.equal(first.code, 0, first.stderr);
    const key = records(projectOf(first.json).items, "items")[0]?.key;
    assert.equal(typeof key, "string");

    const secondHtml = "<!doctype html><title>比較 (設定)</title>\n";
    const secondFile = join(dir, "plan-2.html");
    writeFileSync(secondFile, secondHtml, "utf8");
    const second = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "p2.json", newProjectJson("plan")),
        "--page-name",
        "プラン比較",
        "--family",
        "settings",
        "--html",
        secondFile,
      ],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    const items = records(projectOf(second.json).items, "items");
    assert.equal(items.length, 1, "同じキーなので 1 件のまま");
    assert.deepEqual(
      items[0],
      { kind: "page", key, name: "プラン比較", family: "settings", treatment: DEFAULT_TREATMENT_JSON },
      "family は新しくなる",
    );
    assert.equal(readPage(env, "plan", String(key)), secondHtml);
  } finally {
    cleanup();
  }
});

void test("roundIndex が範囲外・version が 4 は入力の誤り", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const cases: { name: string; project: Record<string, unknown> }[] = [
      { name: "bad-round-index.json", project: newProjectJson("bad-round-index", { roundIndex: 1 }) },
      { name: "bad-version.json", project: projectJsonV3("bad-version", { version: 4 }) },
    ];
    for (const c of cases) {
      const res = runCli(["project", "save", "--project", writeJson(dir, c.name, c.project)], env);
      assert.equal(res.code, 1, c.name);
      assert.equal(payload(res.json).error, "input", c.name);
    }
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");

    // 保存済みとして置いても show は入力の誤り
    const projectDir = join(homeOf(env), "projects", "bad-version");
    mkdirSync(projectDir, { recursive: true });
    const stored = {
      ...projectJsonV3("bad-version", { version: 4 }),
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    };
    writeFileSync(join(projectDir, "project.json"), JSON.stringify(stored), "utf8");
    const show = runCli(["project", "show", "bad-version"], env);
    assert.equal(show.code, 1);
    assert.equal(payload(show.json).error, "input");
  } finally {
    cleanup();
  }
});

void test("items の kind が page 以外は入力の誤り", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const items = [
      { kind: "component", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT_JSON },
      { key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT_JSON },
    ];
    items.forEach((item, index) => {
      const id = `bad-kind-${String(index)}`;
      const res = runCli(["project", "save", "--project", writeJson(dir, `${id}.json`, projectJsonV3(id, { items: [item] }))], env);
      assert.equal(res.code, 1, `save ${id}`);
      assert.equal(payload(res.json).error, "input", `save ${id}`);

      // 保存済みとして置いても show は入力の誤り
      const projectDir = join(homeOf(env), "projects", id);
      mkdirSync(projectDir, { recursive: true });
      const stored = {
        ...projectJsonV3(id, { items: [item] }),
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
      };
      writeFileSync(join(projectDir, "project.json"), JSON.stringify(stored), "utf8");
      const show = runCli(["project", "show", id], env);
      assert.equal(show.code, 1, `show ${id}`);
      assert.equal(payload(show.json).error, "input", `show ${id}`);
    });
  } finally {
    cleanup();
  }
});

void test("ページの書き込みに失敗した save は project.json を前の内容のままにする", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectDir = join(homeOf(env), "projects", "a");
    const lpHtml = "<!doctype html><title>lp</title>\n";
    const lpHtmlFile = join(dir, "lp.html");
    writeFileSync(lpHtmlFile, lpHtml, "utf8");
    const first = runCli(
      ["project", "save", "--project", writeJson(dir, "a.json", newProjectJson("a")), "--page-name", "LP", "--html", lpHtmlFile],
      env,
    );
    assert.equal(first.code, 0, first.stderr);
    const firstProject = projectOf(first.json);

    // pages/blog.html をディレクトリにして、blog の html の rename を失敗させる
    mkdirSync(join(projectDir, "pages", "blog.html"), { recursive: true });
    const blogHtmlFile = join(dir, "blog.html");
    writeFileSync(blogHtmlFile, "<!doctype html><title>blog</title>\n", "utf8");
    const second = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "a-2.json", newProjectJson("a", { brief: briefJson("LP とブログを作る") })),
        "--page-name",
        "ブログ記事",
        "--html",
        blogHtmlFile,
      ],
      env,
    );
    assert.equal(second.code, 1);
    assert.equal(payload(second.json).error, "file");

    // project.json は 1 回目のまま (items に blog は入らず、updatedAt も進まない)
    const after = record(JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8")), "project.json");
    assert.deepEqual(after.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT_JSON }]);
    assert.equal(after.updatedAt, firstProject.updatedAt);
    assert.equal(record(after.brief, "brief").what, "落ち着いた LP を作る");
    assert.equal(readFileSync(join(projectDir, "pages", "lp.html"), "utf8"), lpHtml);
  } finally {
    cleanup();
  }
});

void test("list は updatedAt の新しい順に要約を返す", async () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    assert.deepEqual(records(payload(runCli(["project", "list"], env).json).projects, "projects"), []);

    for (const id of ["one", "two", "three"]) {
      const res = runCli(
        ["project", "save", "--project", writeJson(dir, `${id}.json`, newProjectJson(id, { brief: briefJson(`${id} の依頼`) }))],
        env,
      );
      assert.equal(res.code, 0, res.stderr);
      await sleep(15);
    }

    const listing = payload(runCli(["project", "list"], env).json);
    const projects = records(listing.projects, "projects");
    assert.deepEqual(
      projects.map((project) => project.id),
      ["three", "two", "one"],
    );
    assert.deepEqual(listing.broken, []);
    const first = projects[0];
    assert.ok(first !== undefined, "1 件目がある");
    assert.deepEqual(Object.keys(first).sort(), ["id", "items", "name", "pageType", "updatedAt", "what"]);
    assert.equal(first.what, "three の依頼");
    assert.deepEqual(first.pageType, { name: "LP", family: "lp" });
    assert.equal(first.name, DIRECTION.name);
    assert.deepEqual(first.items, []);
    assert.equal(typeof first.updatedAt, "string");
  } finally {
    cleanup();
  }
});

void test("壊れた project.json は list の broken に出て、同じ id に save し直せる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    for (const id of ["a", "b"]) {
      const res = runCli(["project", "save", "--project", writeJson(dir, `${id}.json`, newProjectJson(id))], env);
      assert.equal(res.code, 0, res.stderr);
    }
    const cDir = join(homeOf(env), "projects", "c");
    mkdirSync(cDir, { recursive: true });
    writeFileSync(join(cDir, "project.json"), "{ broken", "utf8");

    // list は壊れた 1 件を broken に分け、ほかの 2 件は返す
    const list = runCli(["project", "list"], env);
    assert.equal(list.code, 0, list.stderr);
    const body = payload(list.json);
    assert.deepEqual(
      records(body.projects, "projects")
        .map((project) => project.id)
        .sort(),
      ["a", "b"],
    );
    const broken = records(body.broken, "broken");
    assert.equal(broken.length, 1);
    assert.equal(broken[0]?.id, "c");
    assert.equal(typeof broken[0]?.message, "string");

    // 壊れた id にも save し直せる。壊れたファイルは project.json.broken-* に退避して残る
    const htmlFile = join(dir, "c.html");
    writeFileSync(htmlFile, "<!doctype html><title>c</title>\n", "utf8");
    const again = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "c.json", newProjectJson("c", { brief: briefJson("直した依頼") })),
        "--page-name",
        "ブログ記事",
        "--html",
        htmlFile,
      ],
      env,
    );
    assert.equal(again.code, 0, again.stderr);
    const repaired = projectOf(again.json);
    assert.equal(record(repaired.brief, "brief").what, "直した依頼");
    assert.deepEqual(
      repaired.items,
      [{ kind: "page", key: "blog", name: "ブログ記事", family: "blog", treatment: DEFAULT_TREATMENT_JSON }],
      "初回の保存として今回のページだけになる",
    );

    const quarantined = readdirSync(cDir).filter((name) => name.startsWith("project.json.broken-"));
    assert.equal(quarantined.length, 1);
    const brokenName = quarantined[0] ?? "";
    assert.match(brokenName, /^project\.json\.broken-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    assert.equal(readFileSync(join(cDir, brokenName), "utf8"), "{ broken");
    assert.equal(payload(runCli(["project", "show", "c"], env).json).dir, cDir);
  } finally {
    cleanup();
  }
});

void test("id が不正なら save も show も 1 で、一時ディレクトリの外に何も書かない", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const cases = [
      { name: "bad-0.json", id: "../x" },
      { name: "bad-1.json", id: "A" },
      { name: "bad-2.json", id: "" },
    ];
    for (const { name, id } of cases) {
      const res = runCli(["project", "save", "--project", writeJson(dir, name, newProjectJson(id))], env);
      assert.equal(res.code, 1, `save ${JSON.stringify(id)}`);
      assert.equal(payload(res.json).error, "input", `save ${JSON.stringify(id)}`);
      const show = runCli(["project", "show", id], env);
      assert.equal(show.code, 1, `show ${JSON.stringify(id)}`);
      assert.equal(payload(show.json).error, "input", `show ${JSON.stringify(id)}`);
    }
    // 書かれたのは自分で作った 3 ファイルだけ (home も projects も作られない)
    assert.deepEqual(readdirSync(dir).sort(), ["bad-0.json", "bad-1.json", "bad-2.json"]);
    assert.ok(!existsSync(join(dir, "home")), "home は作られない");
    assert.ok(!existsSync(join(dir, "x")), "home の外に書かない");
  } finally {
    cleanup();
  }
});

void test("project.json の中身が不正なら 1 で、何も書かない", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const broken = [
      newProjectJson("bad-direction", {
        rounds: [{ drafts: [{ ...DIRECTION, seed: { ...DIRECTION.seed, baseMode: "sepia" } }], edits: [null] }],
      }),
      newProjectJson("bad-brief", { brief: briefJson("   ") }),
      newProjectJson("bad-points", { points: { ...POINTS_A, color: { x: 2, y: 0 } } }),
      newProjectJson("bad-finetune", { fineTune: { radiusPx: 99 } }),
    ];
    broken.forEach((value, index) => {
      const res = runCli(["project", "save", "--project", writeJson(dir, `broken-${index}.json`, value)], env);
      assert.equal(res.code, 1, `broken-${index}`);
      assert.equal(payload(res.json).error, "input", `broken-${index}`);
    });
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});

void test("無い id の show は input で終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["project", "show", "nope"], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "input");
  } finally {
    cleanup();
  }
});

void test("project の引数の誤りは終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectFile = writeJson(dir, "project.json", newProjectJson("args"));
    const htmlFile = join(dir, "page.html");
    writeFileSync(htmlFile, "<!doctype html>", "utf8");
    const cases: { args: string[]; error: string }[] = [
      { args: ["project", "save"], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--page-name", "lp"], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--html", htmlFile], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--family", "pricing"], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--page-type", "lp", "--html", htmlFile], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--page-name", "その他", "--html", htmlFile], error: "input" },
      {
        args: ["project", "save", "--project", projectFile, "--page-name", "その他", "--family", "nope", "--html", htmlFile],
        error: "input",
      },
      {
        args: ["project", "save", "--project", projectFile, "--page-name", "料金ページ", "--family", "settings", "--html", htmlFile],
        error: "input",
      },
      { args: ["project", "save", "--project", projectFile, "--theme-css", join(dir, "nothing.css")], error: "file" },
      { args: ["project", "save", "--project", join(dir, "nothing.json")], error: "file" },
      { args: ["project", "save", "--project", projectFile, "--unknown", "x"], error: "usage" },
      { args: ["project"], error: "usage" },
      { args: ["project", "bogus"], error: "usage" },
      { args: ["project", "show"], error: "usage" },
      { args: ["project", "show", "a", "b"], error: "usage" },
      { args: ["project", "list", "extra"], error: "usage" },
    ];
    for (const c of cases) {
      const res = runCli(c.args, env);
      const label = c.args.join(" ");
      assert.equal(res.code, 1, label);
      assert.equal(res.stdout, "", label);
      assert.equal(payload(res.json).error, c.error, label);
    }
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});

void test("readPage は保存した html を返し、無ければ null、キーの形を確かめる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const html = "<!doctype html><title>読む</title>";
    const htmlFile = join(dir, "page.html");
    writeFileSync(htmlFile, html, "utf8");
    const res = runCli(
      ["project", "save", "--project", writeJson(dir, "project.json", newProjectJson("reader")), "--page-name", "LP", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    assert.equal(readPage(env, "reader", "lp"), html);
    assert.equal(readPage(env, "reader", "blog"), null);
    assert.equal(readPage(env, "nope", "lp"), null);
    assert.equal(readPage(env, "reader", "a".repeat(40)), null, "40 文字まではキーの形として通る");

    for (const key of ["Bad", "", "../x", "a".repeat(41)]) {
      assert.throws(() => readPage(env, "reader", key), /key/, `key ${JSON.stringify(key)}`);
    }
  } finally {
    cleanup();
  }
});

void test("--component-sheet で保存すると部品帳の item ができ、components/component-sheet.html を書く", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const html = '<!doctype html><html lang="ja"><body>部品帳</body></html>\n';
    const htmlFile = join(dir, "sheet.html");
    writeFileSync(htmlFile, html, "utf8");
    const res = runCli(
      ["project", "save", "--project", writeJson(dir, "sheet.json", projectJsonV3("sheet")), "--component-sheet", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    const projectDir = join(homeOf(env), "projects", "sheet");
    assert.equal(payload(res.json).dir, projectDir);
    assert.deepEqual(saved.items, [{ kind: "component-sheet", key: "component-sheet", name: "部品帳", treatment: DEFAULT_TREATMENT_JSON }]);
    assert.equal(readFileSync(join(projectDir, "components", "component-sheet.html"), "utf8"), html);
    assert.equal(readComponent(env, "sheet", "component-sheet"), html);

    // show は同じ内容と dir を返す
    const show = runCli(["project", "show", "sheet"], env);
    assert.equal(show.code, 0, show.stderr);
    assert.deepEqual(projectOf(show.json), saved);
    assert.equal(payload(show.json).dir, projectDir);
  } finally {
    cleanup();
  }
});

void test("--component で保存すると名前の item ができ、入力の project の treatment が残る", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const html = '<!doctype html><html lang="ja"><body>ボタン</body></html>\n';
    const htmlFile = join(dir, "button.html");
    writeFileSync(htmlFile, html, "utf8");
    const input = projectJsonV3("parts", { treatment: GLASS_TREATMENT });
    const res = runCli(
      ["project", "save", "--project", writeJson(dir, "parts.json", input), "--component", "ボタン", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    const projectDir = join(homeOf(env), "projects", "parts");
    assert.equal(payload(res.json).dir, projectDir);
    assert.deepEqual(saved.treatment, GLASS_TREATMENT);
    assert.deepEqual(saved.items, [{ kind: "component", key: "button", name: "ボタン", treatment: GLASS_TREATMENT }]);
    assert.equal(readFileSync(join(projectDir, "components", "button.html"), "utf8"), html);
    assert.equal(readComponent(env, "parts", "button"), html);
  } finally {
    cleanup();
  }
});

void test("--design-guide で 5 ファイルを保存し、item はプロジェクトの treatment と同じで 1 件", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const folder = writeGuideFolder(join(dir, "five"), [...DESIGN_GUIDE_FILE_NAMES]);
    const res = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "guide.json", projectJsonV3("guide", { treatment: GLASS_TREATMENT })),
        "--design-guide",
        folder,
      ],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    const projectDir = join(homeOf(env), "projects", "guide");
    assert.equal(payload(res.json).dir, projectDir);
    assert.deepEqual(saved.treatment, GLASS_TREATMENT);
    assert.deepEqual(saved.items, [{ kind: "design-guide", key: "design-guide", name: "デザインガイド", treatment: GLASS_TREATMENT }]);
    assert.deepEqual(readdirSync(join(projectDir, "design-guide")).sort(), [...DESIGN_GUIDE_FILE_NAMES].sort());
    for (const name of DESIGN_GUIDE_FILE_NAMES) {
      assert.equal(readFileSync(join(projectDir, "design-guide", name), "utf8"), GUIDE_CONTENTS[name] ?? "", name);
    }
  } finally {
    cleanup();
  }
});

void test("--design-guide は 3 ファイルのフォルダでも保存でき、前の md は消える", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const five = writeGuideFolder(join(dir, "five"), [...DESIGN_GUIDE_FILE_NAMES]);
    const first = runCli(
      ["project", "save", "--project", writeJson(dir, "guide-1.json", projectJsonV3("guide")), "--design-guide", five],
      env,
    );
    assert.equal(first.code, 0, first.stderr);

    const three = writeGuideFolder(join(dir, "three"), ["component-sheet.html", "theme.css", "theme.json"]);
    const second = runCli(
      ["project", "save", "--project", writeJson(dir, "guide-2.json", projectJsonV3("guide")), "--design-guide", three],
      env,
    );
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(projectOf(second.json).items, [
      { kind: "design-guide", key: "design-guide", name: "デザインガイド", treatment: DEFAULT_TREATMENT_JSON },
    ]);
    const projectDir = join(homeOf(env), "projects", "guide");
    assert.deepEqual(readdirSync(join(projectDir, "design-guide")).sort(), ["component-sheet.html", "theme.css", "theme.json"]);
    assert.ok(!existsSync(join(projectDir, "design-guide", "design-guide.md")), "前の design-guide.md は消える");
    assert.ok(!existsSync(join(projectDir, "design-guide", "style-guide.md")), "前の style-guide.md は消える");
  } finally {
    cleanup();
  }
});

void test("--design-guide のフォルダが無い・CSP の無い部品帳は input のエラー", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const missing = runCli(
      ["project", "save", "--project", writeJson(dir, "missing.json", projectJsonV3("missing")), "--design-guide", join(dir, "nothing")],
      env,
    );
    assert.equal(missing.code, 1);
    assert.equal(missing.stdout, "");
    assert.equal(payload(missing.json).error, "input");
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");

    const noCsp = writeGuideFolder(join(dir, "no-csp"), [...DESIGN_GUIDE_FILE_NAMES]);
    writeFileSync(
      join(noCsp, "component-sheet.html"),
      "<!doctype html><html><head><title>部品帳</title></head><body></body></html>",
      "utf8",
    );
    const res = runCli(
      ["project", "save", "--project", writeJson(dir, "no-csp.json", projectJsonV3("no-csp")), "--design-guide", noCsp],
      env,
    );
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    assert.equal(payload(res.json).error, "input");
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});

void test("--design-guide とほかの作るものの指定は同時に使えない", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectFile = writeJson(dir, "guide-args.json", projectJsonV3("guide-args"));
    const folder = writeGuideFolder(join(dir, "source"), [...DESIGN_GUIDE_FILE_NAMES]);
    const htmlFile = join(dir, "make.html");
    writeFileSync(htmlFile, "<!doctype html>", "utf8");
    const extras: string[][] = [
      ["--design-guide", folder, "--component-sheet", "--html", htmlFile],
      ["--design-guide", folder, "--page-name", "LP", "--html", htmlFile],
      ["--design-guide", folder, "--component", "ボタン", "--html", htmlFile],
      ["--design-guide", folder, "--html", htmlFile],
    ];
    for (const extra of extras) {
      const args = ["project", "save", "--project", projectFile, ...extra];
      const label = args.join(" ");
      const res = runCli(args, env);
      assert.equal(res.code, 1, label);
      assert.equal(res.stdout, "", label);
      assert.equal(payload(res.json).error, "usage", label);
    }
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});

void test("作るものの指定の組み合わせが誤りなら usage", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectFile = writeJson(dir, "make-args.json", projectJsonV3("make-args"));
    const htmlFile = join(dir, "make.html");
    writeFileSync(htmlFile, "<!doctype html>", "utf8");
    const extras: string[][] = [
      ["--page-name", "LP", "--component", "ボタン", "--html", htmlFile],
      ["--component", "ボタン", "--component-sheet", "--html", htmlFile],
      ["--component-sheet"],
      ["--html", htmlFile],
      ["--component", "ボタン", "--family", "lp", "--html", htmlFile],
    ];
    for (const extra of extras) {
      const args = ["project", "save", "--project", projectFile, ...extra];
      const label = args.join(" ");
      const res = runCli(args, env);
      assert.equal(res.code, 1, label);
      assert.equal(res.stdout, "", label);
      assert.equal(payload(res.json).error, "usage", label);
    }
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});

void test("--component の名前が 41 文字以上なら input のエラー", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const htmlFile = join(dir, "long.html");
    writeFileSync(htmlFile, "<!doctype html>", "utf8");
    const res = runCli(
      [
        "project",
        "save",
        "--project",
        writeJson(dir, "long.json", projectJsonV3("long")),
        "--component",
        "あ".repeat(41),
        "--html",
        htmlFile,
      ],
      env,
    );
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    assert.equal(payload(res.json).error, "input");
    assert.ok(!existsSync(join(dir, "home")), "何も書かない");
  } finally {
    cleanup();
  }
});
