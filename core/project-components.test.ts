// 保存 (core/project.ts) の items の 3 つの kind と部品の html を CLI の外から確かめる。
// DESIGN_STUDIO_HOME は一時ディレクトリに向け、終わったら消す
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { COMPONENT_SHEET_KEY, COMPONENT_SHEET_NAME, componentKeyOf } from "./component.ts";
import { readComponent, readPage, readProject, saveProject } from "./project.ts";
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
const SOLID_TREATMENT = { surface: "solid", motion: "none", motionSamples: [] };

const LP_PAGE_TYPE: PageType = { name: "LP", family: "lp" };

// 依頼。what 以外は空
function briefJson(what: string): Record<string, string> {
  return { what, mood: "", audience: "", mustHave: "" };
}

// 版 3 の project.json の中身 (createdAt・updatedAt は保存する側が決める)
function projectJsonV3(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    id,
    brief: briefJson("部品を作る"),
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

// 部品帳の item
function sheetItem(treatment: Record<string, unknown>): Record<string, unknown> {
  return { kind: "component-sheet", key: COMPONENT_SHEET_KEY, name: COMPONENT_SHEET_NAME, treatment };
}

// 部品の item
function partItem(name: string, treatment: Record<string, unknown>): Record<string, unknown> {
  return { kind: "component", key: componentKeyOf(name), name, treatment };
}

void test("部品帳を保存すると item が 1 件でき、readComponent が保存した html を返す", () => {
  const { env, cleanup } = tempHome();
  try {
    const html = "<!doctype html><title>部品帳</title>\n";
    const saved = saveProject(env, {
      project: projectJsonV3("sheet"),
      component: { target: { kind: "component-sheet" }, html },
    });

    assert.deepEqual(saved.items, [sheetItem(DEFAULT_TREATMENT)]);
    assert.equal(readComponent(env, "sheet", COMPONENT_SHEET_KEY), html);

    const found = readProject(env, "sheet");
    assert.notEqual(found, null, "保存したプロジェクトを読める");
    assert.deepEqual(found?.project.items, saved.items);
  } finally {
    cleanup();
  }
});

void test("部品は名前ごとに別の item になり、key は componentKeyOf(name)", () => {
  const { env, cleanup } = tempHome();
  try {
    const buttonHtml = "<!doctype html><title>ボタン</title>\n";
    const first = saveProject(env, {
      project: projectJsonV3("parts"),
      component: { target: { kind: "component", name: "ボタン" }, html: buttonHtml },
    });
    assert.deepEqual(first.items, [partItem("ボタン", DEFAULT_TREATMENT)]);

    const freeName = "料金表";
    const freeHtml = "<!doctype html><title>料金表</title>\n";
    const second = saveProject(env, {
      project: projectJsonV3("parts"),
      component: { target: { kind: "component", name: freeName }, html: freeHtml },
    });

    assert.notEqual(componentKeyOf("ボタン"), componentKeyOf(freeName), "名前ごとに別のキー");
    assert.deepEqual(second.items, [partItem("ボタン", DEFAULT_TREATMENT), partItem(freeName, DEFAULT_TREATMENT)]);
    assert.equal(readComponent(env, "parts", componentKeyOf("ボタン")), buttonHtml);
    assert.equal(readComponent(env, "parts", componentKeyOf(freeName)), freeHtml);
  } finally {
    cleanup();
  }
});

void test("部品帳を保存し直すと item は 1 件のままで html が新しくなり、部品とページの item は残る", () => {
  const { env, cleanup } = tempHome();
  try {
    const pageHtml = "<!doctype html><title>LP</title>\n";
    const pageSaved = saveProject(env, {
      project: projectJsonV3("again"),
      page: { pageType: LP_PAGE_TYPE, html: pageHtml },
    });
    assert.deepEqual(pageSaved.items, [{ kind: "page", key: "lp", name: "LP", family: "lp", treatment: DEFAULT_TREATMENT }]);

    const buttonHtml = "<!doctype html><title>ボタン</title>\n";
    saveProject(env, {
      project: projectJsonV3("again"),
      component: { target: { kind: "component", name: "ボタン" }, html: buttonHtml },
    });

    const firstSheetHtml = "<!doctype html><title>部品帳 (古い)</title>\n";
    const firstSheet = saveProject(env, {
      project: projectJsonV3("again"),
      component: { target: { kind: "component-sheet" }, html: firstSheetHtml },
    });
    assert.equal(firstSheet.items.filter((item) => item.kind === "component-sheet").length, 1);

    const secondSheetHtml = "<!doctype html><title>部品帳 (新しい)</title>\n";
    const secondSheet = saveProject(env, {
      project: projectJsonV3("again"),
      component: { target: { kind: "component-sheet" }, html: secondSheetHtml },
    });

    assert.deepEqual(
      secondSheet.items.map((item) => item.kind),
      ["page", "component", "component-sheet"],
      "部品帳の item は増えず、部品とページは残る",
    );
    assert.equal(secondSheet.items.filter((item) => item.kind === "component-sheet").length, 1);
    assert.deepEqual(secondSheet.items[0], {
      kind: "page",
      key: "lp",
      name: "LP",
      family: "lp",
      treatment: DEFAULT_TREATMENT,
    });
    assert.deepEqual(secondSheet.items[1], partItem("ボタン", DEFAULT_TREATMENT));
    assert.equal(readComponent(env, "again", COMPONENT_SHEET_KEY), secondSheetHtml, "html は新しいもの");
    assert.equal(readComponent(env, "again", componentKeyOf("ボタン")), buttonHtml);
    assert.equal(readPage(env, "again", "lp"), pageHtml);
  } finally {
    cleanup();
  }
});

void test("item の treatment は保存したときのプロジェクトの treatment で、直した部品帳だけ新しくなる", () => {
  const { env, cleanup } = tempHome();
  try {
    saveProject(env, {
      project: projectJsonV3("treated", { treatment: GLASS_TREATMENT }),
      page: { pageType: LP_PAGE_TYPE, html: "<!doctype html><title>LP</title>\n" },
    });
    saveProject(env, {
      project: projectJsonV3("treated", { treatment: GLASS_TREATMENT }),
      component: { target: { kind: "component-sheet" }, html: "<!doctype html><title>部品帳</title>\n" },
    });
    saveProject(env, {
      project: projectJsonV3("treated", { treatment: GLASS_TREATMENT }),
      component: { target: { kind: "component", name: "ボタン" }, html: "<!doctype html><title>ボタン</title>\n" },
    });

    const saved = saveProject(env, {
      project: projectJsonV3("treated", { treatment: SOLID_TREATMENT }),
      component: { target: { kind: "component-sheet" }, html: "<!doctype html><title>部品帳 (solid)</title>\n" },
    });

    assert.deepEqual(saved.treatment, SOLID_TREATMENT);
    assert.deepEqual(saved.items, [
      { kind: "page", key: "lp", name: "LP", family: "lp", treatment: GLASS_TREATMENT },
      sheetItem(SOLID_TREATMENT),
      partItem("ボタン", GLASS_TREATMENT),
    ]);

    const found = readProject(env, "treated");
    assert.notEqual(found, null);
    assert.deepEqual(found?.project.items, saved.items, "読み戻しても kind・key・name・treatment は同じ");
  } finally {
    cleanup();
  }
});

void test("ページと部品を両方渡すと入力の誤りで、何も保存しない", () => {
  const { env, cleanup } = tempHome();
  try {
    assertInputError(
      () =>
        saveProject(env, {
          project: projectJsonV3("both"),
          page: { pageType: LP_PAGE_TYPE, html: "<!doctype html><title>LP</title>\n" },
          component: { target: { kind: "component", name: "ボタン" }, html: "<!doctype html><title>ボタン</title>\n" },
        }),
      "page と component の両方",
    );
    assert.equal(readProject(env, "both"), null, "何も保存しない");
  } finally {
    cleanup();
  }
});

void test("items の component と component-sheet の決まりと知らない kind は入力の誤り", () => {
  const { env, cleanup } = tempHome();
  try {
    const cases: { id: string; label: string; item: Record<string, unknown> }[] = [
      {
        id: "bad-key",
        label: "component の key が componentKeyOf(name) と違う",
        item: { kind: "component", key: "other", name: "ボタン", treatment: DEFAULT_TREATMENT },
      },
      {
        id: "bad-sheet-key",
        label: "component-sheet の key が固定の値と違う",
        item: { kind: "component-sheet", key: "sheet", name: COMPONENT_SHEET_NAME, treatment: DEFAULT_TREATMENT },
      },
      {
        id: "bad-sheet-name",
        label: "component-sheet の name が固定の値と違う",
        item: { kind: "component-sheet", key: COMPONENT_SHEET_KEY, name: "部品一覧", treatment: DEFAULT_TREATMENT },
      },
      {
        id: "bad-kind",
        label: "知らない kind",
        item: { kind: "nope", key: "guide", name: "ガイド", treatment: DEFAULT_TREATMENT },
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

void test("無い部品の readComponent は null、キーの形を確かめる", () => {
  const { env, cleanup } = tempHome();
  try {
    saveProject(env, {
      project: projectJsonV3("reader"),
      component: { target: { kind: "component-sheet" }, html: "<!doctype html><title>部品帳</title>\n" },
    });

    assert.equal(readComponent(env, "reader", componentKeyOf("ボタン")), null);
    assert.equal(readComponent(env, "nope", COMPONENT_SHEET_KEY), null);

    for (const key of ["Bad", "", "../x", "a".repeat(41)]) {
      assert.throws(() => readComponent(env, "reader", key), /key/, `key ${JSON.stringify(key)}`);
    }
  } finally {
    cleanup();
  }
});
