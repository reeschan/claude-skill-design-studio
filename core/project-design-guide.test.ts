// 保存 (core/project.ts) の items の design-guide と design-guide/ のフォルダを CLI の外から確かめる。
// DESIGN_STUDIO_HOME は一時ディレクトリに向け、終わったら消す
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { COMPONENT_SHEET_KEY, COMPONENT_SHEET_NAME } from "./component.ts";
import { DESIGN_GUIDE_DIR, DESIGN_GUIDE_FILE_NAMES, DESIGN_GUIDE_KEY, DESIGN_GUIDE_NAME } from "./design-guide.ts";
import type { DesignGuideFile } from "./design-guide.ts";
import { PAGE_CSP } from "./page-html.ts";
import { designGuideDir, readComponent, readDesignGuideFile, readPage, readProject, saveProject } from "./project.ts";
import { findStyle } from "./styles.ts";
import type { Direction, PageType } from "./types.ts";

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

// 表現の既定と、面と動きの見本を選んだ例
const DEFAULT_TREATMENT = { surface: "none", motion: "none", motionSamples: [] };
const GLASS_TREATMENT = { surface: "glass", motion: "animated", motionSamples: ["aurora"] };

const LP_PAGE_TYPE: PageType = { name: "LP", family: "lp" };

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

// 5 ファイル (新しい style-guide で作ったとき) と、文書の無い 3 ファイル (古い style-guide のとき)
const FIVE_FILES: DesignGuideFile[] = [
  { name: "design-guide.md", content: "# デザインガイド\n" },
  { name: "style-guide.md", content: "# スタイルガイド\n" },
  { name: "component-sheet.html", content: SHEET_HTML },
  { name: "theme.css", content: "/* theme */\n" },
  { name: "theme.json", content: "{}\n" },
];
const THREE_FILES = FIVE_FILES.filter((file) => file.name !== "design-guide.md" && file.name !== "style-guide.md");

// 依頼。what 以外は空
function briefJson(what: string): Record<string, string> {
  return { what, mood: "", audience: "", mustHave: "" };
}

// 版 3 の project.json の中身 (createdAt・updatedAt は保存する側が決める)
function projectJsonV3(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id,
    brief: briefJson("デザインガイドを作る"),
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

// デザインガイドの item
function designGuideItem(treatment: Record<string, unknown>): Record<string, unknown> {
  return { kind: "design-guide", key: DESIGN_GUIDE_KEY, name: DESIGN_GUIDE_NAME, treatment };
}

void test("デザインガイドを保存すると item が 1 件でき、design-guide/ に 5 ファイルが書かれる", () => {
  const { env, cleanup } = tempHome();
  try {
    const saved = saveProject(env, {
      project: projectJsonV3("guide", { treatment: GLASS_TREATMENT }),
      designGuide: { files: FIVE_FILES },
    });

    assert.deepEqual(saved.items, [designGuideItem(GLASS_TREATMENT)], "item は 1 件で treatment は保存したプロジェクトのもの");
    const folder = designGuideDir(env, "guide");
    assert.equal(folder, join(env.DESIGN_STUDIO_HOME ?? "", "projects", "guide", DESIGN_GUIDE_DIR), "design-guide/ の絶対パス");
    assert.deepEqual(readdirSync(folder).sort(), [...DESIGN_GUIDE_FILE_NAMES].sort(), "5 ファイルが書かれる");

    const found = readProject(env, "guide");
    assert.notEqual(found, null, "保存したプロジェクトを読める");
    assert.deepEqual(found?.project.items, saved.items, "読み戻しても items は同じ");
  } finally {
    cleanup();
  }
});

void test("readDesignGuideFile は各ファイルの中身を返し、決まりの外の名前と無いファイルは null", () => {
  const { env, cleanup } = tempHome();
  try {
    saveProject(env, { project: projectJsonV3("reader"), designGuide: { files: FIVE_FILES } });

    for (const file of FIVE_FILES) {
      assert.equal(readDesignGuideFile(env, "reader", file.name), file.content, `${file.name} の中身`);
    }
    for (const name of ["../project.json", "project.json", "nope.md", ""]) {
      assert.equal(readDesignGuideFile(env, "reader", name), null, `${JSON.stringify(name)} は null`);
    }
    assert.equal(readDesignGuideFile(env, "nope", "theme.css"), null, "プロジェクトが無ければ null");
  } finally {
    cleanup();
  }
});

void test("3 ファイルで保存し直すと item は 1 件のままで、design-guide.md と style-guide.md は null になる", () => {
  const { env, cleanup } = tempHome();
  try {
    saveProject(env, { project: projectJsonV3("again"), designGuide: { files: FIVE_FILES } });
    const saved = saveProject(env, {
      project: projectJsonV3("again", { treatment: GLASS_TREATMENT }),
      designGuide: { files: THREE_FILES },
    });

    assert.deepEqual(saved.items, [designGuideItem(GLASS_TREATMENT)], "item は 1 件のままで treatment が新しい");
    for (const file of THREE_FILES) {
      assert.equal(readDesignGuideFile(env, "again", file.name), file.content, `${file.name} の中身`);
    }
    assert.equal(readDesignGuideFile(env, "again", "design-guide.md"), null, "古い design-guide.md は残らない");
    assert.equal(readDesignGuideFile(env, "again", "style-guide.md"), null, "古い style-guide.md は残らない");
  } finally {
    cleanup();
  }
});

void test("デザインガイドを保存しても、先に保存したページと部品帳の item は残る", () => {
  const { env, cleanup } = tempHome();
  try {
    const pageHtml = "<!doctype html><title>LP</title>\n";
    const sheetHtml = "<!doctype html><title>部品帳</title>\n";
    saveProject(env, { project: projectJsonV3("mixed"), page: { pageType: LP_PAGE_TYPE, html: pageHtml } });
    saveProject(env, { project: projectJsonV3("mixed"), component: { target: { kind: "component-sheet" }, html: sheetHtml } });

    const saved = saveProject(env, { project: projectJsonV3("mixed"), designGuide: { files: THREE_FILES } });

    assert.deepEqual(
      saved.items.map((item) => item.kind),
      ["page", "component-sheet", "design-guide"],
      "先の item は残り、デザインガイドは末尾に足される",
    );
    assert.deepEqual(saved.items[0], { kind: "page", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT });
    assert.deepEqual(saved.items[1], {
      kind: "component-sheet",
      key: COMPONENT_SHEET_KEY,
      name: COMPONENT_SHEET_NAME,
      treatment: DEFAULT_TREATMENT,
    });
    assert.deepEqual(saved.items[2], designGuideItem(DEFAULT_TREATMENT));
    assert.equal(readPage(env, "mixed", "lp"), pageHtml);
    assert.equal(readComponent(env, "mixed", COMPONENT_SHEET_KEY), sheetHtml);
  } finally {
    cleanup();
  }
});

void test("デザインガイドとページ・部品を同時に渡すと入力の誤りで、何も保存しない", () => {
  const { env, cleanup } = tempHome();
  try {
    assertInputError(
      () =>
        saveProject(env, {
          project: projectJsonV3("both-page"),
          page: { pageType: LP_PAGE_TYPE, html: "<!doctype html><title>LP</title>\n" },
          designGuide: { files: THREE_FILES },
        }),
      "page と designGuide の両方",
    );
    assert.equal(readProject(env, "both-page"), null, "page と designGuide では何も保存しない");

    assertInputError(
      () =>
        saveProject(env, {
          project: projectJsonV3("both-part"),
          component: { target: { kind: "component-sheet" }, html: "<!doctype html><title>部品帳</title>\n" },
          designGuide: { files: THREE_FILES },
        }),
      "component と designGuide の両方",
    );
    assert.equal(readProject(env, "both-part"), null, "component と designGuide では何も保存しない");
  } finally {
    cleanup();
  }
});

void test("files が決まりを満たさないと入力の誤りで、プロジェクトは保存されない", () => {
  const { env, cleanup } = tempHome();
  try {
    const noTheme = THREE_FILES.filter((file) => file.name !== "theme.css");
    assertInputError(() => saveProject(env, { project: projectJsonV3("no-theme"), designGuide: { files: noTheme } }), "theme.css が無い");
    assert.equal(readProject(env, "no-theme"), null, "何も保存しない");
    assert.equal(existsSync(designGuideDir(env, "no-theme")), false, "フォルダも作らない");
  } finally {
    cleanup();
  }
});

void test("items の design-guide の key・name が固定の値と違えば入力の誤り", () => {
  const { env, cleanup } = tempHome();
  try {
    const cases = [
      {
        id: "bad-guide-key",
        label: "key が固定の値と違う",
        item: { kind: "design-guide", key: "guide", name: DESIGN_GUIDE_NAME, treatment: DEFAULT_TREATMENT },
      },
      {
        id: "bad-guide-name",
        label: "name が固定の値と違う",
        item: { kind: "design-guide", key: DESIGN_GUIDE_KEY, name: "ガイド", treatment: DEFAULT_TREATMENT },
      },
    ];
    for (const c of cases) {
      assertInputError(() => saveProject(env, { project: projectJsonV3(c.id, { items: [c.item] }) }), c.label);
      assert.equal(readProject(env, c.id), null, c.label);
    }
  } finally {
    cleanup();
  }
});
