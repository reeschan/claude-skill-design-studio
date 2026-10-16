// project サブコマンドと core/project.ts を CLI の外から確かめる。home は一時ディレクトリ
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readPage } from "../core/project.ts";
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

// 依頼文からプロジェクトの JSON を作る (createdAt・updatedAt は保存側が決める)
function projectJson(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, prompt: "落ち着いた LP を作る", pageType: "lp", direction: DIRECTION, pages: [], ...overrides };
}

// 値を JSON ファイルとして書く
function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
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

void test("save は project.json・theme.css・pages/<種類>.html を書き、show が同じ内容を返す", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectFile = writeJson(dir, "project.json", projectJson("hello"));
    const themeCss = ":root { --color-primary: oklch(0.5 0.15 260); }\n";
    const themeCssFile = join(dir, "source-theme.css");
    writeFileSync(themeCssFile, themeCss, "utf8");
    const html = '<!doctype html><html lang="ja"><body>こんにちは</body></html>\n';
    const htmlFile = join(dir, "source-page.html");
    writeFileSync(htmlFile, html, "utf8");

    const res = runCli(
      ["project", "save", "--project", projectFile, "--theme-css", themeCssFile, "--page-type", "lp", "--html", htmlFile],
      env,
    );
    assert.equal(res.code, 0, res.stderr);
    const saved = projectOf(res.json);
    const projectDir = join(homeOf(env), "projects", "hello");
    assert.equal(payload(res.json).dir, projectDir);

    assert.deepEqual(JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8")), saved);
    assert.equal(readFileSync(join(projectDir, "theme.css"), "utf8"), themeCss);
    assert.equal(readFileSync(join(projectDir, "pages", "lp.html"), "utf8"), html);
    assert.deepEqual(saved.pages, ["lp"]);
    assert.equal(saved.pageType, "lp");
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

void test("ページ付きの save を 2 回すると pages が重複なく積まれ、createdAt はそのまま・updatedAt は進む", async () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const projectDir = join(homeOf(env), "projects", "twice");
    const lpHtml = "<!doctype html><title>lp</title>\n";
    const lpHtmlFile = join(dir, "lp.html");
    writeFileSync(lpHtmlFile, lpHtml, "utf8");
    const firstArgs = [
      "project",
      "save",
      "--project",
      writeJson(dir, "first.json", projectJson("twice")),
      "--page-type",
      "lp",
      "--html",
      lpHtmlFile,
    ];
    const first = projectOf(runCli(firstArgs, env).json);
    assert.deepEqual(first.pages, ["lp"]);

    await sleep(15);

    const blogHtml = "<!doctype html><title>blog</title>\n";
    const blogHtmlFile = join(dir, "blog.html");
    writeFileSync(blogHtmlFile, blogHtml, "utf8");
    const secondInput = projectJson("twice", { pages: [], prompt: "LP とブログを作る" });
    const secondArgs = [
      "project",
      "save",
      "--project",
      writeJson(dir, "second.json", secondInput),
      "--page-type",
      "blog",
      "--html",
      blogHtmlFile,
    ];
    const res = runCli(secondArgs, env);
    assert.equal(res.code, 0, res.stderr);
    const second = projectOf(res.json);

    assert.deepEqual(second.pages, ["lp", "blog"]);
    assert.equal(second.prompt, "LP とブログを作る");
    assert.equal(second.createdAt, first.createdAt);
    assert.ok(String(second.updatedAt) > String(first.updatedAt), "updatedAt は進む");
    assert.equal(readFileSync(join(projectDir, "pages", "lp.html"), "utf8"), lpHtml);
    assert.equal(readFileSync(join(projectDir, "pages", "blog.html"), "utf8"), blogHtml);
  } finally {
    cleanup();
  }
});

void test("入力の project の pages は積まず、ページの種類だけを積む", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const input = projectJson("nopage", { pages: ["dashboard"] });
    const res = runCli(["project", "save", "--project", writeJson(dir, "nopage.json", input)], env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(projectOf(res.json).pages, [], "html を書いていない種類は pages に入らない");
    assert.equal(readPage(env, "nopage", "dashboard"), null);
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
      ["project", "save", "--project", writeJson(dir, "a.json", projectJson("a")), "--page-type", "lp", "--html", lpHtmlFile],
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
        writeJson(dir, "a-2.json", projectJson("a", { prompt: "LP とブログを作る" })),
        "--page-type",
        "blog",
        "--html",
        blogHtmlFile,
      ],
      env,
    );
    assert.equal(second.code, 1);
    assert.equal(payload(second.json).error, "file");

    // project.json は 1 回目のまま (pages に blog は入らず、updatedAt も進まない)
    const after = record(JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8")), "project.json");
    assert.deepEqual(after.pages, ["lp"]);
    assert.equal(after.updatedAt, firstProject.updatedAt);
    assert.equal(after.prompt, "落ち着いた LP を作る");
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
      const res = runCli(["project", "save", "--project", writeJson(dir, `${id}.json`, projectJson(id, { prompt: `${id} の依頼` }))], env);
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
    assert.deepEqual(Object.keys(first).sort(), ["id", "name", "pageType", "pages", "prompt", "updatedAt"]);
    assert.equal(first.prompt, "three の依頼");
    assert.equal(first.pageType, "lp");
    assert.equal(first.name, DIRECTION.name);
    assert.deepEqual(first.pages, []);
    assert.equal(typeof first.updatedAt, "string");
  } finally {
    cleanup();
  }
});

void test("壊れた project.json は list の broken に出て、同じ id に save し直せる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    for (const id of ["a", "b"]) {
      const res = runCli(["project", "save", "--project", writeJson(dir, `${id}.json`, projectJson(id))], env);
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
        writeJson(dir, "c.json", projectJson("c", { prompt: "直した依頼" })),
        "--page-type",
        "blog",
        "--html",
        htmlFile,
      ],
      env,
    );
    assert.equal(again.code, 0, again.stderr);
    const repaired = projectOf(again.json);
    assert.equal(repaired.prompt, "直した依頼");
    assert.deepEqual(repaired.pages, ["blog"], "初回の保存として今回のページの種類だけになる");

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
      const res = runCli(["project", "save", "--project", writeJson(dir, name, projectJson(id))], env);
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
      projectJson("bad-direction", { direction: { ...DIRECTION, seed: { ...DIRECTION.seed, baseMode: "sepia" } } }),
      projectJson("bad-prompt", { prompt: "   " }),
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
    const projectFile = writeJson(dir, "project.json", projectJson("args"));
    const htmlFile = join(dir, "page.html");
    writeFileSync(htmlFile, "<!doctype html>", "utf8");
    const cases: { args: string[]; error: string }[] = [
      { args: ["project", "save"], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--page-type", "lp"], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--html", htmlFile], error: "usage" },
      { args: ["project", "save", "--project", projectFile, "--page-type", "nope", "--html", htmlFile], error: "input" },
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

void test("readPage は保存した html を返し、無ければ null", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const html = "<!doctype html><title>読む</title>";
    const htmlFile = join(dir, "page.html");
    writeFileSync(htmlFile, html, "utf8");
    const args = [
      "project",
      "save",
      "--project",
      writeJson(dir, "project.json", projectJson("reader")),
      "--page-type",
      "lp",
      "--html",
      htmlFile,
    ];
    const res = runCli(args, env);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(readPage(env, "reader", "lp"), html);
    assert.equal(readPage(env, "reader", "blog"), null);
    assert.equal(readPage(env, "nope", "lp"), null);
  } finally {
    cleanup();
  }
});
