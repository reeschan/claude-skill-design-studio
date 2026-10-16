// アプリのローカルサーバーのテスト。サーバーを子プロセスで起動し、HTTP で叩いて確かめる。
// claude CLI はモック、style-guide は偽物、home・skills・plugins・gallery は一時ディレクトリに向ける
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { pageHtml as makePageHtml } from "../core/page-html.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOCK_LLM = join(REPO_ROOT, "app", "mock-llm.mjs");
const FAKE_STYLE_GUIDE = join(REPO_ROOT, "test", "fixtures", "fake-style-guide");
// サーバーが 1 行目に出す URL
const URL_LINE_RE = /^design-studio app: (http:\/\/127\.0\.0\.1:\d+\/)$/;
// 偽 style-guide の summary が返す fontsUrl の値
const FAKE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// JSON の値をキーの順にたどる。途中がオブジェクトでなければ undefined
function get(x: unknown, ...path: string[]): unknown {
  let cur = x;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

// JSON の値がオブジェクトであることを確かめて返す
function rec(x: unknown): Record<string, unknown> {
  if (!isRecord(x)) assert.fail(`オブジェクトではありません: ${JSON.stringify(x)}`);
  return x;
}

// JSON の値が配列であることを確かめて返す
function arr(x: unknown): unknown[] {
  if (!Array.isArray(x)) assert.fail(`配列ではありません: ${JSON.stringify(x)}`);
  return x;
}

// JSON の値が文字列であることを確かめて返す
function str(x: unknown): string {
  if (typeof x !== "string") assert.fail(`文字列ではありません: ${JSON.stringify(x)}`);
  return x;
}

let child: ChildProcess | null = null;
let dir = "";
let base = "";
let port = 0;

// サーバーの 1 行目から URL を読む
function serverUrl(server: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`サーバーが起動しませんでした:\n${out}`)), 15000);
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const line = out.split(/\r?\n/)[0] ?? "";
      const match = URL_LINE_RE.exec(line);
      if (match === null) return;
      clearTimeout(timer);
      resolve(match[1] ?? "");
    });
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`サーバーが終了しました (${String(code)}):\n${out}`));
    });
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "design-studio-server-"));
  const gallery = join(dir, "gallery");
  mkdirSync(join(gallery, "pop"), { recursive: true });
  mkdirSync(join(gallery, "nope"), { recursive: true });
  writeFileSync(join(gallery, "pop", "lp.html"), '<!doctype html>\n<html lang="ja"><body>pop の LP</body></html>\n', "utf8");
  writeFileSync(join(gallery, "nope", "lp.html"), '<!doctype html>\n<html lang="ja"><body>知らないスタイル</body></html>\n', "utf8");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESIGN_STUDIO_HOME: join(dir, "home"),
    DESIGN_STUDIO_SKILLS_DIR: join(dir, "skills"),
    DESIGN_STUDIO_PLUGINS_DIR: join(dir, "plugins"),
    DESIGN_STUDIO_GALLERY_DIR: gallery,
    STYLE_GUIDE_DIR: FAKE_STYLE_GUIDE,
    DESIGN_STUDIO_LLM_CMD: JSON.stringify([process.execPath, MOCK_LLM]),
    MOCK_LLM_ARGS_FILE: join(dir, "llm-args.json"),
  };
  const server = spawn(process.execPath, ["app/server.ts", "--port", "0", "--no-browser"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = server;
  server.stderr?.resume(); // 子プロセスの標準エラーで詰まらせない
  const url = await serverUrl(server);
  base = url.endsWith("/") ? url.slice(0, -1) : url;
  port = Number(new URL(base).port);
});

after(async () => {
  const server = child;
  child = null;
  if (server !== null && server.exitCode === null) {
    const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
    server.kill();
    await exited;
  }
  rmSync(dir, { recursive: true, force: true });
});

type HttpResult = { status: number; text: string; type: string; csp: string; json: unknown };

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

async function fetchPath(path: string): Promise<HttpResult> {
  const r = await fetch(base + path);
  const text = await r.text();
  return {
    status: r.status,
    text,
    type: r.headers.get("content-type") ?? "",
    csp: r.headers.get("content-security-policy") ?? "",
    json: parseJson(text),
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });
  const text = await r.text();
  return {
    status: r.status,
    text,
    type: r.headers.get("content-type") ?? "",
    csp: r.headers.get("content-security-policy") ?? "",
    json: parseJson(text),
  };
}

// 生の HTTP 要求。Host ヘッダーや Content-Length を自分で決めたいときに使う
function rawRequest(method: "GET" | "POST", path: string, body: string, headers: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            text,
            type: res.headers["content-type"] ?? "",
            csp: String(res.headers["content-security-policy"] ?? ""),
            json: parseJson(text),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// サーバーが一時ファイルに使う接頭辞のディレクトリ。使い終わったら消えていることを確かめる
const tempDirs = (prefix: string): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(prefix));

let cachedDirections: unknown[] | null = null;

async function directionsForTest(): Promise<unknown[]> {
  if (cachedDirections !== null) return cachedDirections;
  const r = await post("/api/directions", { prompt: "落ち着いた請求書アプリ", pageType: "lp" });
  assert.equal(r.status, 200, r.text);
  const list = arr(get(r.json, "directions"));
  assert.equal(list.length, 3, r.text);
  cachedDirections = list;
  return list;
}

let cachedMix: unknown = null;

// 4 軸のミックス。id は mix-0120 (色 A・フォント B・形 C・配置 A)
async function mixForTest(): Promise<unknown> {
  if (cachedMix !== null) return cachedMix;
  const directions = await directionsForTest();
  const r = await post("/api/mix", { directions, picks: { color: 0, font: 1, shape: 2, layout: 0 } });
  assert.equal(r.status, 200, r.text);
  cachedMix = get(r.json, "direction");
  return cachedMix;
}

void test("1. GET / が 200 で HTML、/app の不正なパスは 404", async () => {
  const index = await fetchPath("/");
  assert.equal(index.status, 200);
  assert.match(index.type, /^text\/html; charset=utf-8/);
  assert.match(index.text, /<title>design-studio<\/title>/);
  assert.match(index.text, /準備中/);

  // fetch はパスを正規化するので、生の要求で確かめる
  assert.equal((await rawRequest("GET", "/app/../server.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/..%2fserver.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/server.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/X.js", "", {})).status, 404);
  assert.equal((await fetchPath("/app/nope.js")).status, 404);
});

void test("2. GET /api/meta が style-guide と LLM の有無を返す", async () => {
  const r = await fetchPath("/api/meta");
  assert.equal(r.status, 200);
  assert.equal(get(r.json, "llmAvailable"), true);
  assert.equal(get(r.json, "styleGuide"), "ok");
});

void test("3. GET /api/catalog が 12 件、POST /api/catalog/enabled が反映される", async () => {
  const before = await fetchPath("/api/catalog");
  assert.equal(before.status, 200);
  const entries = arr(get(before.json, "entries"));
  assert.equal(entries.length, 12, before.text);
  const target = entries.find((entry) => get(entry, "id") === "react-doctor");
  assert.equal(get(target, "enabled"), true);

  const off = await post("/api/catalog/enabled", { id: "react-doctor", enabled: false });
  assert.equal(off.status, 200, off.text);
  assert.equal(get(off.json, "entry", "id"), "react-doctor");
  assert.equal(get(off.json, "entry", "enabled"), false);

  const after = await fetchPath("/api/catalog");
  const updated = arr(get(after.json, "entries")).find((entry) => get(entry, "id") === "react-doctor");
  assert.equal(get(updated, "enabled"), false);
  const config: unknown = JSON.parse(readFileSync(join(dir, "home", "config.json"), "utf8"));
  assert.equal(get(config, "enabled", "react-doctor"), false);

  const unknown = await post("/api/catalog/enabled", { id: "nope", enabled: true });
  assert.equal(unknown.status, 400);
  assert.equal(get(unknown.json, "error"), "input");
});

void test("4. GET /api/install-plan が計画を返し、スキル置き場に何も書かない", async () => {
  const r = await fetchPath("/api/install-plan");
  assert.equal(r.status, 200);
  const plan = arr(get(r.json, "plan"));
  assert.equal(plan.length, 12, r.text);
  assert.ok(plan.every((item) => typeof get(item, "action") === "string"));
  assert.equal(existsSync(join(dir, "skills")), false);
});

void test("5. GET /api/styles が 6 件、GET /api/themes/pop が cssForPage を返す", async () => {
  const styles = await fetchPath("/api/styles");
  assert.equal(styles.status, 200);
  const list = arr(get(styles.json, "styles"));
  assert.equal(list.length, 6, styles.text);
  assert.ok(list.some((style) => get(style, "id") === "pop"));

  const theme = await fetchPath("/api/themes/pop");
  assert.equal(theme.status, 200, theme.text);
  assert.equal(get(theme.json, "themeId"), "pop");
  const css = str(get(theme.json, "cssForPage"));
  assert.ok(css.includes("--fake-radius"), css);
  assert.ok(!css.includes("tailwindcss"), css);
  assert.equal(get(theme.json, "fontsUrl"), FAKE_FONTS_URL);

  assert.equal((await fetchPath("/api/themes/nope")).status, 404);
});

void test("6. GET /api/gallery が一時の置き場にある見本だけを返す", async () => {
  const r = await fetchPath("/api/gallery");
  assert.equal(r.status, 200);
  const items = arr(get(r.json, "items"));
  assert.deepEqual(items, [{ styleId: "pop", pageType: "lp", url: "/gallery/pop/lp.html" }]);

  const html = await fetchPath("/gallery/pop/lp.html");
  assert.equal(html.status, 200);
  assert.match(html.type, /^text\/html; charset=utf-8/);
  assert.match(html.text, /pop の LP/);

  assert.equal((await fetchPath("/gallery/pop/blog.html")).status, 404);
  assert.equal((await fetchPath("/gallery/nope/lp.html")).status, 404);
  assert.equal((await fetchPath("/gallery/pop/xxx.html")).status, 404);
});

void test("7. POST /api/directions が方向性の案を 3 つ返す", async () => {
  const directions = await directionsForTest();
  assert.equal(get(directions[0], "id"), "dir-a");
  assert.equal(get(directions[1], "id"), "dir-b");
  assert.equal(get(directions[2], "id"), "dir-c");
  assert.ok(str(get(directions[0], "name")));
  assert.ok(str(get(directions[0], "seed", "tone")));
});

void test("8. POST /api/directions が screenshot を一時ファイルで渡し、あとで消す", async () => {
  const beforeScreen = tempDirs("design-studio-screen-");
  const beforeShot = tempDirs("design-studio-shot-");
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
  const r = await post("/api/directions", { prompt: "参考画像つきの依頼", pageType: "blog", screenshot: png });
  assert.equal(r.status, 200, r.text);
  assert.equal(arr(get(r.json, "directions")).length, 3);

  // モックが受け取った引数: 参考画像の 1 ファイルだけを読める指定が入る
  const args: unknown = JSON.parse(readFileSync(join(dir, "llm-args.json"), "utf8"));
  assert.match(str(get(args, "addDir")), /design-studio-shot-/);
  const files = arr(get(args, "addDirFiles"));
  assert.equal(files.length, 1, JSON.stringify(files));
  assert.match(str(files[0]), /\.png$/);

  // サーバーと core が作った一時ディレクトリは残っていない
  assert.deepEqual(tempDirs("design-studio-screen-"), beforeScreen);
  assert.deepEqual(tempDirs("design-studio-shot-"), beforeShot);

  const bad = await post("/api/directions", { prompt: "参考画像つきの依頼", pageType: "lp", screenshot: "data:image/gif;base64,AAAA" });
  assert.equal(bad.status, 400);
  assert.equal(get(bad.json, "error"), "input");
});

void test("9. POST /api/mix が 4 軸のミックスを返す", async () => {
  const direction = rec(await mixForTest());
  assert.equal(get(direction, "id"), "mix-0120");
  assert.equal(get(direction, "seed", "id"), "mix-0120");

  const missing = await post("/api/mix", { directions: await directionsForTest() });
  assert.equal(missing.status, 400);
  assert.equal(get(missing.json, "error"), "input");
});

void test("10. POST /api/render が骨組みの HTML を返す", async () => {
  const direction = rec(await mixForTest());
  const r = await post("/api/render", { direction, pageType: "lp", mode: "dark" });
  assert.equal(r.status, 200, r.text);
  const html = str(get(r.json, "html"));
  assert.ok(html.includes(`data-theme="${str(get(direction, "id"))}"`), html.slice(0, 300));
  assert.match(html, /data-mode="dark"/);
  assert.equal(get(r.json, "themeId"), get(direction, "id"));
  assert.equal(get(r.json, "layout"), "centered");
  assert.equal(get(r.json, "failed"), 2);
  assert.equal(get(r.json, "checks", "light", "total"), 5);
});

void test("11. POST /api/page が 1 ファイルの HTML を返す", async () => {
  const direction = rec(await mixForTest());
  const r = await post("/api/page", { prompt: "落ち着いた請求書アプリ", direction, pageType: "lp" });
  assert.equal(r.status, 200, r.text);
  const html = str(get(r.json, "html"));
  assert.ok(html.includes(`data-theme="${str(get(direction, "id"))}"`), html.slice(0, 300));
  assert.match(html, /id="theme"/);
  assert.ok(html.includes("--fake-radius"), "テーマの cssForPage が差し込まれていません");
});

void test("12. POST /api/projects のあと、一覧・詳細・ページが返る", async () => {
  const direction = rec(await mixForTest());
  const pageHtml = makePageHtml({
    title: "保存したページ",
    themeId: "test-project",
    mode: "light",
    cssForPage: "",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
    body: "<p>保存したページ</p>",
  });
  const created = await post("/api/projects", {
    project: { id: "test-project", prompt: "落ち着いた請求書アプリ", pageType: "lp", direction, pages: [] },
    pageType: "lp",
    html: pageHtml,
  });
  assert.equal(created.status, 200, created.text);
  assert.equal(get(created.json, "project", "id"), "test-project");
  assert.deepEqual(get(created.json, "project", "pages"), ["lp"]);

  // theme.css はサーバーが direction から作って保存する
  const themeCss = readFileSync(join(dir, "home", "projects", "test-project", "theme.css"), "utf8");
  assert.ok(themeCss.includes("--fake-radius"), themeCss);

  const list = await fetchPath("/api/projects");
  assert.equal(list.status, 200);
  const summaries = arr(get(list.json, "projects"));
  assert.ok(
    summaries.some((summary) => get(summary, "id") === "test-project"),
    list.text,
  );

  const one = await fetchPath("/api/projects/test-project");
  assert.equal(one.status, 200);
  assert.equal(get(one.json, "project", "id"), "test-project");

  const page = await fetchPath("/api/projects/test-project/pages/lp");
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html; charset=utf-8/);
  assert.match(page.text, /保存したページ/);
  assert.equal(page.csp, "sandbox allow-scripts");

  // CSP の meta より前にスクリプトがある html は 400 で、保存されない
  const evilHtml = pageHtml.replace("<head>", '<script>fetch(location.origin+"/api/projects")</script><head>');
  assert.notEqual(evilHtml, pageHtml);
  const evil = await post("/api/projects", {
    project: { id: "test-project-evil", prompt: "x", pageType: "lp", direction, pages: [] },
    pageType: "lp",
    html: evilHtml,
  });
  assert.equal(evil.status, 400, evil.text);
  assert.equal(get(evil.json, "error"), "input");
  assert.equal(get(evil.json, "message"), "html に CSP の meta がありません");
  assert.equal((await fetchPath("/api/projects/test-project-evil")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project-evil/pages/lp")).status, 404);

  // pages を省いた保存もできる (アプリは保存するまでページを持たない)
  const second = await post("/api/projects", { project: { id: "test-project-2", prompt: "二つ目の依頼", pageType: "blog", direction } });
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(get(second.json, "project", "pages"), []);

  assert.equal((await fetchPath("/api/projects/nope")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project/pages/dashboard")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project/pages/xxx")).status, 404);
});

void test("13. Host / Origin / Content-Type / 壊れた JSON / 欠け / 大きすぎる Content-Length", async () => {
  const directions = await directionsForTest();
  const picks = { color: 0, font: 0, shape: 0, layout: 0 };

  const evilOrigin = await post("/api/mix", { directions, picks }, { Origin: "http://evil.example" });
  assert.equal(evilOrigin.status, 403);
  assert.equal(get(evilOrigin.json, "error"), "forbidden");

  const localOrigin = await post("/api/mix", { directions, picks }, { Origin: `http://localhost:${String(port)}` });
  assert.equal(localOrigin.status, 200, localOrigin.text);

  assert.equal((await rawRequest("POST", "/api/mix", JSON.stringify({ directions, picks }), { Host: "evil.example" })).status, 403);

  const plain = await post("/api/mix", { directions, picks }, { "Content-Type": "text/plain" });
  assert.equal(plain.status, 415);

  const broken = await post("/api/mix", "{not json");
  assert.equal(broken.status, 400);
  assert.equal(get(broken.json, "error"), "bad-json");

  const missing = await post("/api/directions", { pageType: "lp" });
  assert.equal(missing.status, 400);
  assert.equal(get(missing.json, "error"), "input");

  // Content-Length だけを大きくした小さな要求 (本文は読み捨てられる)
  assert.equal((await rawRequest("POST", "/api/directions", "{}", { "Content-Length": String(8 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await rawRequest("POST", "/api/mix", "{}", { "Content-Length": String(1024 * 1024 + 1) })).status, 413);
});

void test("14. GET も Host / Origin が 127.0.0.1 / localhost 以外なら 403", async () => {
  const evilHost = await rawRequest("GET", "/api/projects", "", { Host: "evil.example" });
  assert.equal(evilHost.status, 403);
  assert.equal(get(evilHost.json, "error"), "forbidden");

  assert.equal((await rawRequest("GET", "/", "", { Host: "evil.example" })).status, 403);

  const evilOrigin = await rawRequest("GET", "/api/catalog", "", { Origin: "http://evil.example" });
  assert.equal(evilOrigin.status, 403);
  assert.equal(get(evilOrigin.json, "error"), "forbidden");

  // 静的ファイルの GET も同じ (経路の照合より前に止まる)
  assert.equal((await rawRequest("GET", "/gallery/pop/lp.html", "", { Host: `attacker.example:${String(port)}` })).status, 403);

  // 正しい Host の GET は今どおり 200
  assert.equal((await rawRequest("GET", "/api/projects", "", { Host: `localhost:${String(port)}` })).status, 200);
  assert.equal((await rawRequest("GET", "/api/projects", "", { Origin: `http://localhost:${String(port)}` })).status, 200);
  assert.equal((await fetchPath("/api/projects")).status, 200);
});

void test("15. 上限を超える本物の本文の POST も、読み捨ててから 413 を返す", async () => {
  // /api/mix の上限 (1MB) を約 1MB 超える本文を、続けて 3 回送る
  const pad = "x".repeat(2 * 1024 * 1024);
  for (let i = 0; i < 3; i += 1) {
    const r = await post("/api/mix", JSON.stringify({ directions: [], picks: { color: 0, font: 0, shape: 0, layout: 0 }, pad }));
    assert.equal(r.status, 413, r.text);
    assert.equal(get(r.json, "error"), "too-large");
  }

  // レビューの再現手順にあった /api/directions の 9MB も同じ
  const big = await post("/api/directions", JSON.stringify({ prompt: "x", pageType: "lp", pad: "x".repeat(9 * 1024 * 1024) }));
  assert.equal(big.status, 413, big.text);
  assert.equal(get(big.json, "error"), "too-large");
});
