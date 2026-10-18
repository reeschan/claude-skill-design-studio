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
import { checkMotion, hasPageCsp, pageHtml as makePageHtml } from "../core/page-html.ts";
import { pageKeyOf } from "../core/page-type.ts";
import { LAYOUTS, PAGE_TYPE_CANDIDATES } from "../core/types.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOCK_LLM = join(REPO_ROOT, "app", "mock-llm.mjs");
const FAKE_STYLE_GUIDE = join(REPO_ROOT, "test", "fixtures", "fake-style-guide");
// サーバーが 1 行目に出す URL
const URL_LINE_RE = /^design-studio app: (http:\/\/127\.0\.0\.1:\d+\/)$/;
// 偽 style-guide の summary が返す fontsUrl の値
const FAKE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap";
// パッドの点。色と配置は案 A の隅、フォントは案 B の隅、形は案 C の隅
const MIX_POINTS = { color: { x: 0, y: 0 }, font: { x: 1, y: 0 }, shape: { x: 0, y: 1 }, layout: { x: 0, y: 0 } };
// 4 軸とも案 A の隅
const POINTS_A = { color: { x: 0, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } };
// 表現の既定 (版 2 から直したときの treatment)
const DEFAULT_TREATMENT = { surface: "none", motion: "none", motionSamples: [] };
// テストで使う表現。面は Glass、動きは見せる (見本は marquee)
const GLASS_TREATMENT = { surface: "glass", motion: "animated", motionSamples: ["marquee"] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// JSON の値をキーの順にたどる。途中がオブジェクトか配列でなければ undefined
function get(x: unknown, ...path: (string | number)[]): unknown {
  let cur = x;
  for (const key of path) {
    if (Array.isArray(cur)) {
      cur = typeof key === "number" ? cur[key] : undefined;
      continue;
    }
    if (!isRecord(cur)) return undefined;
    cur = cur[String(key)];
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
// サーバーの env。モードを変えた別のサーバーを起こすテストが土台にする
let serverEnv: NodeJS.ProcessEnv = {};

type RunningServer = { child: ChildProcess; base: string };

// サーバーを子プロセスで起動し、1 行目の URL から叩き先を決める
async function startServer(env: NodeJS.ProcessEnv): Promise<RunningServer> {
  const server = spawn(process.execPath, ["app/server.ts", "--port", "0", "--no-browser"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.resume(); // 子プロセスの標準エラーで詰まらせない
  const url = await serverUrl(server);
  return { child: server, base: url.endsWith("/") ? url.slice(0, -1) : url };
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill();
  await exited;
}

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
  serverEnv = env;
  const started = await startServer(env);
  child = started.child;
  base = started.base;
  port = Number(new URL(base).port);
});

after(async () => {
  const server = child;
  child = null;
  if (server !== null) await stopServer(server);
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

async function fetchPath(path: string, at = base): Promise<HttpResult> {
  const r = await fetch(at + path);
  const text = await r.text();
  return {
    status: r.status,
    text,
    type: r.headers.get("content-type") ?? "",
    csp: r.headers.get("content-security-policy") ?? "",
    json: parseJson(text),
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}, at = base): Promise<HttpResult> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const r = await fetch(at + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });
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

// 偽の LLM が最後に受け取ったプロンプト (MOCK_LLM_ARGS_FILE の記録)
function lastMockPrompt(): string {
  const raw: unknown = JSON.parse(readFileSync(join(dir, "llm-args.json"), "utf8"));
  return str(get(raw, "prompt"));
}

let cachedDirections: unknown[] | null = null;

// 4 件の方向性の案。テストで何度も使うので覚える
async function directionsForTest(): Promise<unknown[]> {
  if (cachedDirections !== null) return cachedDirections;
  const r = await post("/api/directions", { brief: { what: "落ち着いた請求書アプリ" }, pageType: { name: "料金ページ" } });
  assert.equal(r.status, 200, r.text);
  const list = arr(get(r.json, "directions"));
  assert.equal(list.length, 4, r.text);
  cachedDirections = list;
  return list;
}

let cachedMix: unknown = null;

// 色と配置は A・フォントは B・形は C を指す点でのミックス。テストで何度も使うので覚える
async function mixForTest(): Promise<unknown> {
  if (cachedMix !== null) return cachedMix;
  const directions = await directionsForTest();
  const r = await post("/api/mix", { directions, points: MIX_POINTS });
  assert.equal(r.status, 200, r.text);
  cachedMix = get(r.json, "direction");
  return cachedMix;
}

// 版 2・3 で同じ項目 (POST /api/projects の入力)。画面の種類は自由な名前
function projectContentForTest(id: string, directions: unknown[]): Record<string, unknown> {
  return {
    id,
    brief: { what: "落ち着いた請求書アプリ", mood: "", audience: "", mustHave: "" },
    pageType: { name: "請求書一覧", family: "dashboard" },
    rounds: [{ drafts: directions, edits: directions.map(() => null) }],
    roundIndex: 0,
    points: MIX_POINTS,
    fineTune: {},
  };
}

// 版 2 のプロジェクト
function projectForTest(id: string, directions: unknown[]): Record<string, unknown> {
  return { version: 2, ...projectContentForTest(id, directions), pages: [] };
}

// 版 3 のプロジェクト
function projectVersion3ForTest(id: string, directions: unknown[], treatment: Record<string, unknown>): Record<string, unknown> {
  return { version: 3, ...projectContentForTest(id, directions), treatment, items: [] };
}

// 保存に使う、CSP の meta のある 1 ファイルの HTML (ページ・部品帳・部品で同じ殻)
function savedHtmlForTest(title: string, body: string, themeId: string): string {
  return makePageHtml({
    title,
    themeId,
    mode: "light",
    cssForPage: "",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
    body,
  });
}

void test("1. GET / が 200 で HTML、/app の不正なパスは 404", async () => {
  const index = await fetchPath("/");
  assert.equal(index.status, 200);
  assert.match(index.type, /^text\/html; charset=utf-8/);
  assert.match(index.text, /<title>design-studio<\/title>/);
  assert.match(index.text, /id="wb-brief"[\s\S]*id="wb-stage"[\s\S]*id="wb-panels"/);

  // fetch はパスを正規化するので、生の要求で確かめる
  assert.equal((await rawRequest("GET", "/app/../server.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/..%2fserver.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/server.ts", "", {})).status, 404);
  assert.equal((await rawRequest("GET", "/app/X.js", "", {})).status, 404);
  assert.equal((await fetchPath("/app/nope.js")).status, 404);
});

void test("2. GET /api/meta が style-guide・LLM・画面の種類・配置・フォントの組を返す", async () => {
  const r = await fetchPath("/api/meta");
  assert.equal(r.status, 200);
  assert.equal(get(r.json, "llmAvailable"), true);
  assert.equal(get(r.json, "styleGuide"), "ok");
  assert.deepEqual(get(r.json, "pageTypes"), PAGE_TYPE_CANDIDATES);
  assert.deepEqual(get(r.json, "layouts"), LAYOUTS);
  const fontPairs = arr(get(r.json, "fontPairs"));
  assert.equal(fontPairs.length, 2, r.text);
  assert.equal(get(fontPairs[0], "japanese"), true);
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

void test("5. GET /api/styles が 7 件、GET /api/themes/pop が cssForPage を返す", async () => {
  const styles = await fetchPath("/api/styles");
  assert.equal(styles.status, 200);
  const list = arr(get(styles.json, "styles"));
  assert.equal(list.length, 7, styles.text);
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

void test("7. POST /api/directions が依頼から 4 案と family を返す", async () => {
  // 自由な名前で family を省くと、LLM が答えた骨組みの種類が返る
  const r = await post("/api/directions", { brief: { what: "落ち着いた請求書アプリ" }, pageType: { name: "請求書アプリ" } });
  assert.equal(r.status, 200, r.text);
  const directions = arr(get(r.json, "directions"));
  assert.equal(directions.length, 4, r.text);
  assert.equal(get(directions[0], "id"), "dir-a");
  assert.equal(get(directions[1], "id"), "dir-b");
  assert.equal(get(directions[2], "id"), "dir-c");
  assert.equal(get(directions[3], "id"), "dir-d");
  assert.ok(str(get(directions[0], "name")));
  assert.ok(str(get(directions[0], "seed", "tone")));
  assert.equal(get(r.json, "family"), "pricing");

  // 候補の名前なら、family はその候補のものになる
  const candidate = await post("/api/directions", { brief: { what: "技術ブログを作る" }, pageType: { name: "ブログ記事" } });
  assert.equal(candidate.status, 200, candidate.text);
  assert.equal(get(candidate.json, "family"), "blog");

  // brief.what が空なら 400
  const empty = await post("/api/directions", { brief: { what: "  " }, pageType: { name: "ブログ記事" } });
  assert.equal(empty.status, 400);
  assert.equal(get(empty.json, "error"), "input");
  assert.equal(get(empty.json, "message"), "作りたいもの (brief.what) を書いてください");

  // 旧 prompt は受けない (brief が無いので入力の誤り)
  const old = await post("/api/directions", { prompt: "古い依頼", pageType: { name: "ブログ記事" } });
  assert.equal(old.status, 400);
  assert.equal(get(old.json, "error"), "input");
});

void test("8. POST /api/directions が screenshot を一時ファイルで渡し、あとで消す", async () => {
  const beforeScreen = tempDirs("design-studio-screen-");
  const beforeShot = tempDirs("design-studio-shot-");
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;
  const r = await post("/api/directions", { brief: { what: "参考画像つきの依頼" }, pageType: { name: "ブログ記事" }, screenshot: png });
  assert.equal(r.status, 200, r.text);
  assert.equal(arr(get(r.json, "directions")).length, 4);
  assert.equal(get(r.json, "family"), "blog");

  // モックが受け取った引数: 参考画像の 1 ファイルだけを読める指定が入る
  const args: unknown = JSON.parse(readFileSync(join(dir, "llm-args.json"), "utf8"));
  assert.match(str(get(args, "addDir")), /design-studio-shot-/);
  const files = arr(get(args, "addDirFiles"));
  assert.equal(files.length, 1, JSON.stringify(files));
  assert.match(str(files[0]), /\.png$/);

  // サーバーと core が作った一時ディレクトリは残っていない
  assert.deepEqual(tempDirs("design-studio-screen-"), beforeScreen);
  assert.deepEqual(tempDirs("design-studio-shot-"), beforeShot);

  const bad = await post("/api/directions", {
    brief: { what: "参考画像つきの依頼" },
    pageType: { name: "ブログ記事" },
    screenshot: "data:image/gif;base64,AAAA",
  });
  assert.equal(bad.status, 400);
  assert.equal(get(bad.json, "error"), "input");
});

void test("9. POST /api/mix が点の位置のミックスを返す", async () => {
  const directions = await directionsForTest();
  const r = await post("/api/mix", { directions, points: MIX_POINTS });
  assert.equal(r.status, 200, r.text);
  const mixed = rec(get(r.json, "mixed"));
  const direction = rec(get(r.json, "direction"));
  assert.match(str(get(mixed, "id")), /^mix-[0-9a-f]{12}$/);
  assert.equal(get(direction, "seed", "id"), get(direction, "id"));
  assert.deepEqual(direction, mixed);
  assert.deepEqual(get(r.json, "weights"), {
    color: [1, 0, 0, 0],
    font: [0, 1, 0, 0],
    shape: [0, 0, 1, 0],
    layout: [1, 0, 0, 0],
  });
  assert.deepEqual(get(r.json, "snapped"), { color: 0, font: 1, shape: 2, layout: 0, copy: 0 });
  // 吸着の案がそのまま効く (フォントは案 B のもの)
  assert.deepEqual(get(direction, "seed", "font"), get(directions[1], "seed", "font"));

  // 微調整を重ねると direction だけが tune- の id に変わる
  const fine = await post("/api/mix", { directions, points: MIX_POINTS, fineTune: { radiusPx: 12 } });
  assert.equal(fine.status, 200, fine.text);
  assert.deepEqual(get(fine.json, "mixed"), get(r.json, "mixed"));
  const tuned = rec(get(fine.json, "direction"));
  assert.match(str(get(tuned, "id")), /^tune-[0-9a-f]{12}$/);
  assert.equal(get(tuned, "seed", "shape", "radiusPx"), 12);

  const missing = await post("/api/mix", { directions });
  assert.equal(missing.status, 400);
  assert.equal(get(missing.json, "error"), "input");
  const badPoint = await post("/api/mix", { directions, points: { ...MIX_POINTS, color: { x: 1.5, y: 0 } } });
  assert.equal(badPoint.status, 400);
  assert.equal(get(badPoint.json, "error"), "input");
});

void test("10. POST /api/render が family の骨組みの HTML を返す", async () => {
  const direction = rec(await mixForTest());
  const r = await post("/api/render", { direction, family: "settings", mode: "dark" });
  assert.equal(r.status, 200, r.text);
  const html = str(get(r.json, "html"));
  assert.ok(html.includes(`data-theme="${str(get(direction, "id"))}"`), html.slice(0, 300));
  assert.match(html, /data-mode="dark"/);
  assert.equal(get(r.json, "themeId"), get(direction, "id"));
  assert.equal(get(r.json, "layout"), "sidebar"); // ミックスの配置は案 A (dir-a) のもの
  assert.equal(get(r.json, "failed"), 2);
  assert.equal(get(r.json, "checks", "light", "total"), 5);

  // 旧 pageType のキーは受けない (family が無いので入力の誤り)
  const old = await post("/api/render", { direction, pageType: "settings" });
  assert.equal(old.status, 400);
  assert.equal(get(old.json, "error"), "input");
});

void test("11. POST /api/page が依頼と画面の種類で 1 ファイルの HTML を返す", async () => {
  const direction = rec(await mixForTest());
  const r = await post("/api/page", {
    brief: { what: "料金の比較ページを作る" },
    direction,
    pageType: { name: "料金ページ", family: "pricing" },
  });
  assert.equal(r.status, 200, r.text);
  const html = str(get(r.json, "html"));
  assert.ok(html.includes(`data-theme="${str(get(direction, "id"))}"`), html.slice(0, 300));
  assert.match(html, /id="theme"/);
  assert.ok(html.includes("--fake-radius"), "テーマの cssForPage が差し込まれていません");

  // LLM には画面の種類の名前が渡る
  const args: unknown = JSON.parse(readFileSync(join(dir, "llm-args.json"), "utf8"));
  assert.ok(str(get(args, "prompt")).includes("料金ページ"), "prompt に画面の種類の名前がありません");

  // family が無いと 400
  const noFamily = await post("/api/page", { brief: { what: "料金の比較ページを作る" }, direction, pageType: { name: "料金ページ" } });
  assert.equal(noFamily.status, 400);
  assert.equal(get(noFamily.json, "error"), "input");
});

void test("12. POST /api/tokens が Tailwind・JSON・CSS の 3 形式を返す", async () => {
  const direction = rec(await mixForTest());
  const r = await post("/api/tokens", { direction });
  assert.equal(r.status, 200, r.text);
  const tailwind = str(get(r.json, "tailwind"));
  const json = str(get(r.json, "json"));
  const css = str(get(r.json, "css"));
  assert.ok(tailwind.includes('@import "tailwindcss";'), tailwind);
  const parsed: unknown = JSON.parse(json);
  assert.ok(Array.isArray(parsed), "json が JSON として読めません");
  assert.ok(!css.includes("@import"), css);
  assert.ok(css.includes("--fake-radius"), css);

  const bad = await post("/api/tokens", {});
  assert.equal(bad.status, 400);
  assert.equal(get(bad.json, "error"), "input");
});

void test("13. POST /api/projects が版 2 の入力を版 3 として保存し、一覧・詳細・ページが返る", async () => {
  const directions = await directionsForTest();
  const pageHtml = makePageHtml({
    title: "保存したページ",
    themeId: "test-project",
    mode: "light",
    cssForPage: "",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
    body: "<p>保存したページ</p>",
  });
  const pageType = { name: "請求書一覧", family: "dashboard" } as const;
  const key = pageKeyOf(pageType);
  assert.match(key, /^page-[0-9a-f]{8}$/); // 英数字の無い自由な名前は page-<ハッシュ> になる

  const created = await post("/api/projects", { project: projectForTest("test-project", directions), page: { pageType, html: pageHtml } });
  assert.equal(created.status, 200, created.text);
  assert.equal(get(created.json, "project", "id"), "test-project");
  assert.equal(get(created.json, "project", "version"), 3);
  assert.deepEqual(get(created.json, "project", "items"), [
    { kind: "page", key, name: "請求書一覧", family: "dashboard", treatment: DEFAULT_TREATMENT },
  ]);

  // theme.css はサーバーが今の回を混ぜ直した方向性の seed で作って保存する
  const themeCss = readFileSync(join(dir, "home", "projects", "test-project", "theme.css"), "utf8");
  assert.ok(themeCss.includes("--fake-radius"), themeCss);

  // 詳細は同じ回・点を返す
  const one = await fetchPath("/api/projects/test-project");
  assert.equal(one.status, 200, one.text);
  assert.equal(get(one.json, "project", "roundIndex"), 0);
  assert.equal(get(one.json, "project", "rounds", 0, "drafts", 0, "id"), "dir-a");
  assert.equal(get(one.json, "project", "rounds", 0, "drafts", 3, "id"), "dir-d");
  assert.deepEqual(get(one.json, "project", "rounds", 0, "edits"), [null, null, null, null]);
  assert.deepEqual(get(one.json, "project", "points"), MIX_POINTS);
  assert.equal(get(one.json, "project", "pageType", "name"), "請求書一覧");

  // ページは key で読める (sandbox の CSP つき)
  const page = await fetchPath(`/api/projects/test-project/pages/${key}`);
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html; charset=utf-8/);
  assert.match(page.text, /保存したページ/);
  assert.equal(page.csp, "sandbox allow-scripts");

  // 形の合わない key と、無い key は 404
  assert.equal((await fetchPath("/api/projects/test-project/pages/Bad")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project/pages/dashboard")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project/pages/xxx")).status, 404);

  // 候補の名前のページはキーが family のものになる
  const pricing = await post("/api/projects", {
    project: projectForTest("test-project-pricing", directions),
    page: { pageType: { name: "料金ページ", family: "pricing" }, html: pageHtml },
  });
  assert.equal(pricing.status, 200, pricing.text);
  assert.deepEqual(get(pricing.json, "project", "items"), [
    { kind: "page", key: "pricing", name: "料金ページ", family: "pricing", treatment: DEFAULT_TREATMENT },
  ]);
  assert.equal((await fetchPath("/api/projects/test-project-pricing/pages/pricing")).status, 200);

  // CSP の meta より前にスクリプトがある html は 400 で、保存されない
  const evilHtml = pageHtml.replace("<head>", '<script>fetch(location.origin+"/api/projects")</script><head>');
  assert.notEqual(evilHtml, pageHtml);
  const evil = await post("/api/projects", {
    project: projectForTest("test-project-evil", directions),
    page: { pageType, html: evilHtml },
  });
  assert.equal(evil.status, 400, evil.text);
  assert.equal(get(evil.json, "error"), "input");
  assert.equal(get(evil.json, "message"), "html に CSP の meta がありません");
  assert.equal((await fetchPath("/api/projects/test-project-evil")).status, 404);
  assert.equal((await fetchPath(`/api/projects/test-project-evil/pages/${key}`)).status, 404);

  // page を省いた保存もできる (アプリは保存するまでページを持たない)
  const second = await post("/api/projects", { project: projectForTest("test-project-2", directions) });
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(get(second.json, "project", "items"), []);
  assert.deepEqual(get(second.json, "project", "treatment"), DEFAULT_TREATMENT);

  // 旧 pageType・html の最上位のキーは使わない (page を省いたのと同じ)
  const old = await post("/api/projects", { project: projectForTest("test-project-old", directions), pageType: "lp", html: pageHtml });
  assert.equal(old.status, 200, old.text);
  assert.deepEqual(get(old.json, "project", "items"), []);

  const list = await fetchPath("/api/projects");
  assert.equal(list.status, 200);
  const summaries = arr(get(list.json, "projects"));
  assert.ok(
    summaries.some((summary) => get(summary, "id") === "test-project"),
    list.text,
  );

  assert.equal((await fetchPath("/api/projects/nope")).status, 404);
});

void test("14. Host / Origin / Content-Type / 壊れた JSON / 欠け / 大きすぎる Content-Length", async () => {
  const directions = await directionsForTest();

  const evilOrigin = await post("/api/mix", { directions, points: POINTS_A }, { Origin: "http://evil.example" });
  assert.equal(evilOrigin.status, 403);
  assert.equal(get(evilOrigin.json, "error"), "forbidden");

  const localOrigin = await post("/api/mix", { directions, points: POINTS_A }, { Origin: `http://localhost:${String(port)}` });
  assert.equal(localOrigin.status, 200, localOrigin.text);

  assert.equal(
    (await rawRequest("POST", "/api/mix", JSON.stringify({ directions, points: POINTS_A }), { Host: "evil.example" })).status,
    403,
  );

  const plain = await post("/api/mix", { directions, points: POINTS_A }, { "Content-Type": "text/plain" });
  assert.equal(plain.status, 415);

  const broken = await post("/api/mix", "{not json");
  assert.equal(broken.status, 400);
  assert.equal(get(broken.json, "error"), "bad-json");

  const missing = await post("/api/directions", { pageType: { name: "ブログ記事" } });
  assert.equal(missing.status, 400);
  assert.equal(get(missing.json, "error"), "input");

  // Content-Length だけを大きくした小さな要求 (本文は読み捨てられる)
  assert.equal((await rawRequest("POST", "/api/directions", "{}", { "Content-Length": String(8 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await rawRequest("POST", "/api/mix", "{}", { "Content-Length": String(1024 * 1024 + 1) })).status, 413);
});

void test("15. GET も Host / Origin が 127.0.0.1 / localhost 以外なら 403", async () => {
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

void test("16. 上限を超える本物の本文の POST も、読み捨ててから 413 を返す", async () => {
  // /api/mix の上限 (1MB) を約 1MB 超える本文を、続けて 3 回送る
  const pad = "x".repeat(2 * 1024 * 1024);
  for (let i = 0; i < 3; i += 1) {
    const r = await post("/api/mix", JSON.stringify({ directions: [], points: POINTS_A, pad }));
    assert.equal(r.status, 413, r.text);
    assert.equal(get(r.json, "error"), "too-large");
  }

  // /api/directions の上限 (8MB) を超える 9MB も同じ
  const big = await post(
    "/api/directions",
    JSON.stringify({ brief: { what: "x" }, pageType: { name: "LP" }, pad: "x".repeat(9 * 1024 * 1024) }),
  );
  assert.equal(big.status, 413, big.text);
  assert.equal(get(big.json, "error"), "too-large");
});

void test("17. GET /api/treatments が面と動きの一覧、GET /api/motions/<id>/preview が見本の HTML を返す", async () => {
  const listing = await fetchPath("/api/treatments");
  assert.equal(listing.status, 200, listing.text);
  const surfaces = arr(get(listing.json, "surfaces"));
  const motions = arr(get(listing.json, "motions"));
  assert.deepEqual(
    surfaces.map((surface) => get(surface, "id")),
    ["none", "material", "glass", "solid"],
  );
  assert.deepEqual(
    surfaces.map((surface) => get(surface, "name")),
    ["指定しない", "Material", "Glass", "Solid"],
  );
  assert.equal(motions.length, 12, listing.text);
  const aurora = motions.find((motion) => get(motion, "id") === "aurora");
  assert.equal(get(aurora, "name"), "ゆっくり流れるオーロラの背景");
  assert.ok(str(get(aurora, "css")).includes("prefers-reduced-motion"), "動きの見本に reduced-motion の扱いがありません");

  const preview = await fetchPath("/api/motions/aurora/preview");
  assert.equal(preview.status, 200, preview.text);
  assert.match(preview.type, /^text\/html; charset=utf-8/);
  assert.equal(preview.csp, "sandbox allow-scripts");
  assert.ok(preview.text.includes('<style id="motion">'), preview.text.slice(0, 500));
  assert.ok(preview.text.includes(str(get(aurora, "html"))), "見本の html が入っていません");
  assert.ok(preview.text.includes("--fake-radius"), "見本帳の minimal のテーマが入っていません");

  assert.equal((await fetchPath("/api/motions/no-such/preview")).status, 404);
  assert.equal((await fetchPath("/api/motions/aurora")).status, 404);
});

void test("18. POST /api/directions と POST /api/page が treatment を LLM のプロンプトに通す", async () => {
  // 方向性の案: 面の名前 (Glass) がプロンプトに入る
  const directions = await post("/api/directions", {
    brief: { what: "素材感のある料金ページ" },
    pageType: { name: "料金ページ" },
    treatment: GLASS_TREATMENT,
  });
  assert.equal(directions.status, 200, directions.text);
  assert.equal(arr(get(directions.json, "directions")).length, 4);
  const directionsPrompt = lastMockPrompt();
  assert.ok(directionsPrompt.includes("## 表現"), "方向性のプロンプトに表現の節がありません");
  assert.ok(directionsPrompt.includes("Glass"), "方向性のプロンプトに面の名前がありません");

  // ページ: 選んだ見本 (marquee) の名前がプロンプトに入る
  const direction = rec(await mixForTest());
  const page = await post("/api/page", {
    brief: { what: "素材感のある料金ページ" },
    direction,
    pageType: { name: "料金ページ", family: "pricing" },
    treatment: GLASS_TREATMENT,
  });
  assert.equal(page.status, 200, page.text);
  assert.ok(str(get(page.json, "html")).includes('id="theme"'), page.text.slice(0, 300));
  const pagePrompt = lastMockPrompt();
  assert.ok(pagePrompt.includes("## 表現"), "ページのプロンプトに表現の節がありません");
  assert.ok(pagePrompt.includes("流れ続ける帯"), "ページのプロンプトに見本 marquee の name がありません");
});

void test("19. treatment を省いた POST /api/directions・POST /api/page は今までどおり", async () => {
  const directions = await post("/api/directions", { brief: { what: "落ち着いた請求書アプリ" }, pageType: { name: "ブログ記事" } });
  assert.equal(directions.status, 200, directions.text);
  assert.equal(arr(get(directions.json, "directions")).length, 4);
  assert.ok(!lastMockPrompt().includes("## 表現"), "既定の表現なのに表現の節があります");

  const direction = rec(await mixForTest());
  const page = await post("/api/page", {
    brief: { what: "料金の比較ページを作る" },
    direction,
    pageType: { name: "料金ページ", family: "pricing" },
  });
  assert.equal(page.status, 200, page.text);
  assert.match(str(get(page.json, "html")), /id="theme"/);
  assert.ok(!lastMockPrompt().includes("## 表現"), "既定の表現なのに表現の節があります");
});

void test("20. treatment の面の id が台帳に無ければ 400 (error: input)", async () => {
  const direction = rec(await mixForTest());
  const targets: { path: string; body: Record<string, unknown> }[] = [
    { path: "/api/directions", body: { brief: { what: "料金ページ" }, pageType: { name: "料金ページ" } } },
    { path: "/api/page", body: { brief: { what: "料金ページ" }, direction, pageType: { name: "料金ページ", family: "pricing" } } },
    { path: "/api/render", body: { direction, family: "pricing" } },
  ];
  for (const target of targets) {
    const r = await post(target.path, { ...target.body, treatment: { surface: "no-such" } });
    assert.equal(r.status, 400, `${target.path}: ${r.text}`);
    assert.equal(get(r.json, "error"), "input", `${target.path}: ${r.text}`);
  }
});

void test("21. POST /api/render は treatment の面を骨組みに重ねる", async () => {
  const direction = rec(await mixForTest());
  const solid = await post("/api/render", {
    direction,
    family: "settings",
    treatment: { surface: "solid", motion: "none", motionSamples: [] },
  });
  assert.equal(solid.status, 200, solid.text);
  assert.equal(get(solid.json, "surface"), "solid");
  assert.ok(str(get(solid.json, "html")).includes('<style id="surface">'), "面の style が入っていません");

  const none = await post("/api/render", { direction, family: "settings" });
  assert.equal(none.status, 200, none.text);
  assert.equal(get(none.json, "surface"), "none");
  assert.ok(!str(get(none.json, "html")).includes('<style id="surface">'), "既定なのに面の style が入っています");
});

void test("22. ページの動きの点検: motion-then-good は 2 回で通り、no-reduced-motion は 502", async () => {
  const pageBody = {
    brief: { what: "動きのある料金ページ" },
    direction: rec(await mixForTest()),
    pageType: { name: "料金ページ", family: "pricing" },
  };

  // 1 回目は reduced-motion の指定が無く、2 回目で通る。偽の LLM は 2 回呼ばれる
  const motionServer = await startServer({
    ...serverEnv,
    MOCK_LLM_MODE: "motion-then-good",
    MOCK_LLM_COUNTER: join(dir, "counter-motion.txt"),
  });
  try {
    const r = await post("/api/page", pageBody, {}, motionServer.base);
    assert.equal(r.status, 200, r.text);
    assert.match(str(get(r.json, "html")), /id="theme"/);
    assert.equal(readFileSync(join(dir, "counter-motion.txt"), "utf8"), "2", "偽の LLM が 2 回呼ばれていません");
  } finally {
    await stopServer(motionServer.child);
  }

  // 2 回とも reduced-motion の指定が無ければ bad-page (502)
  const badServer = await startServer({ ...serverEnv, MOCK_LLM_MODE: "no-reduced-motion" });
  try {
    const r = await post("/api/page", pageBody, {}, badServer.base);
    assert.equal(r.status, 502, r.text);
    assert.equal(get(r.json, "error"), "bad-page");
  } finally {
    await stopServer(badServer.child);
  }
});

void test("23. 版 3 の project が treatment と items ごと保存され、版 2 の project.json は版 3 として読める", async () => {
  const directions = await directionsForTest();
  const pageType = { name: "商品詳細", family: "product" } as const;
  const key = pageKeyOf(pageType);
  const pageHtml = makePageHtml({
    title: "表現つきのページ",
    themeId: "test-project-v3",
    mode: "light",
    cssForPage: "",
    fontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
    body: "<p>表現つきのページ</p>",
  });

  const created = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-v3", directions, GLASS_TREATMENT),
    page: { pageType, html: pageHtml },
  });
  assert.equal(created.status, 200, created.text);
  assert.equal(get(created.json, "project", "version"), 3);
  assert.deepEqual(get(created.json, "project", "treatment"), GLASS_TREATMENT);
  assert.equal(get(created.json, "project", "items", 0, "kind"), "page");
  assert.equal(get(created.json, "project", "items", 0, "key"), key);
  assert.deepEqual(get(created.json, "project", "items", 0, "treatment"), GLASS_TREATMENT);

  // 読み戻しても同じ
  const read = await fetchPath("/api/projects/test-project-v3");
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(get(read.json, "project", "treatment"), GLASS_TREATMENT);
  assert.equal(get(read.json, "project", "items", 0, "kind"), "page");
  assert.deepEqual(get(read.json, "project", "items", 0, "treatment"), GLASS_TREATMENT);

  // 版 2 の project.json を置いたプロジェクトも、読むと版 3 になる (ページは既定の表現の item)
  const version2 = {
    ...projectForTest("test-project-v2", directions),
    pages: [{ key: "dashboard", name: "請求書一覧", family: "dashboard" }],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
  };
  const version2Dir = join(dir, "home", "projects", "test-project-v2");
  mkdirSync(version2Dir, { recursive: true });
  writeFileSync(join(version2Dir, "project.json"), JSON.stringify(version2, null, 2) + "\n", "utf8");

  const upgraded = await fetchPath("/api/projects/test-project-v2");
  assert.equal(upgraded.status, 200, upgraded.text);
  assert.equal(get(upgraded.json, "project", "version"), 3);
  assert.deepEqual(get(upgraded.json, "project", "treatment"), DEFAULT_TREATMENT);
  assert.deepEqual(get(upgraded.json, "project", "items"), [
    { kind: "page", key: "dashboard", name: "請求書一覧", family: "dashboard", treatment: DEFAULT_TREATMENT },
  ]);
});

void test("24. POST /api/generate がページ・部品帳・部品の HTML を返す", async () => {
  const direction = rec(await mixForTest());
  const brief = { what: "作るものを選べる作業台" };

  // ページ: make は検証後の値 (pageType に family が付く)
  const page = await post("/api/generate", {
    brief,
    direction,
    make: { kind: "page", pageType: { name: "料金ページ", family: "pricing" } },
  });
  assert.equal(page.status, 200, page.text);
  assert.deepEqual(get(page.json, "make"), { kind: "page", pageType: { name: "料金ページ", family: "pricing" } });
  const pageHtml = str(get(page.json, "html"));
  assert.ok(hasPageCsp(pageHtml), "ページの html に CSP の meta がありません");
  assert.equal(checkMotion(pageHtml).ok, true, "ページの html が動きの点検に通りません");

  // 部品帳: 偽の LLM の部品帳の応答
  const sheet = await post("/api/generate", { brief, direction, make: { kind: "component-sheet" } });
  assert.equal(sheet.status, 200, sheet.text);
  assert.deepEqual(get(sheet.json, "make"), { kind: "component-sheet" });
  const sheetHtml = str(get(sheet.json, "html"));
  assert.match(sheetHtml, /<title>モックの部品帳<\/title>/, sheetHtml.slice(0, 300));
  assert.ok(hasPageCsp(sheetHtml), "部品帳の html に CSP の meta がありません");
  assert.equal(checkMotion(sheetHtml).ok, true, "部品帳の html が動きの点検に通りません");

  // 部品: 名前は検証後の値 (trim される)
  const component = await post("/api/generate", { brief, direction, make: { kind: "component", name: " ボタン " } });
  assert.equal(component.status, 200, component.text);
  assert.deepEqual(get(component.json, "make"), { kind: "component", name: "ボタン" });
  const componentHtml = str(get(component.json, "html"));
  assert.match(componentHtml, /<title>モックの部品<\/title>/, componentHtml.slice(0, 300));
  assert.ok(hasPageCsp(componentHtml), "部品の html に CSP の meta がありません");
  assert.equal(checkMotion(componentHtml).ok, true, "部品の html が動きの点検に通りません");
});

void test("25. POST /api/generate が treatment を LLM のプロンプトに通す", async () => {
  const direction = rec(await mixForTest());
  const treatment = { surface: "glass", motion: "animated", motionSamples: ["aurora", "marquee"] };
  const r = await post("/api/generate", {
    brief: { what: "素材感のある部品" },
    direction,
    make: { kind: "component", name: "カード" },
    treatment,
  });
  assert.equal(r.status, 200, r.text);
  const prompt = lastMockPrompt();
  assert.ok(prompt.includes("## 表現"), "プロンプトに表現の節がありません");
  assert.ok(prompt.includes("Glass"), "プロンプトに面の名前がありません");
  assert.ok(prompt.includes("ゆっくり流れるオーロラの背景"), "プロンプトに見本 aurora の名前がありません");
  assert.ok(prompt.includes("流れ続ける帯"), "プロンプトに見本 marquee の名前がありません");
});

void test("26. POST /api/generate の make の誤りは 400", async () => {
  const direction = rec(await mixForTest());
  const brief = { what: "作るものの誤り" };
  const makes: unknown[] = [{ kind: "design-guide" }, { kind: "nope" }, { kind: "component", name: "  " }];
  for (const make of makes) {
    const r = await post("/api/generate", { brief, direction, make });
    assert.equal(r.status, 400, `${JSON.stringify(make)}: ${r.text}`);
    assert.equal(get(r.json, "error"), "input");
  }

  // make が無いときも 400
  const missing = await post("/api/generate", { brief, direction });
  assert.equal(missing.status, 400, missing.text);
  assert.equal(get(missing.json, "error"), "input");
});

void test("27. 部品の生成が reduced-motion を通らなければ 502 (bad-component)", async () => {
  const badServer = await startServer({ ...serverEnv, MOCK_LLM_MODE: "no-reduced-motion" });
  try {
    const r = await post(
      "/api/generate",
      { brief: { what: "動きのある部品" }, direction: rec(await mixForTest()), make: { kind: "component", name: "ボタン" } },
      {},
      badServer.base,
    );
    assert.equal(r.status, 502, r.text);
    assert.equal(get(r.json, "error"), "bad-component");
  } finally {
    await stopServer(badServer.child);
  }
});

void test("28. POST /api/projects が部品帳・部品・ページを保存し、components から読める", async () => {
  const directions = await directionsForTest();
  const pageType = { name: "請求書一覧", family: "dashboard" } as const;
  const sheetHtml = savedHtmlForTest("保存した部品帳", "<p>保存した部品帳</p>", "test-project-components");
  const sheetHtml2 = savedHtmlForTest("保存した部品帳 (作り直し)", "<p>作り直した部品帳</p>", "test-project-components");
  const buttonHtml = savedHtmlForTest("保存した部品", "<p>保存したボタン</p>", "test-project-components");
  const pageHtml = savedHtmlForTest("保存したページ", "<p>保存したページ</p>", "test-project-components");

  const sheet = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-components", directions, GLASS_TREATMENT),
    component: { target: { kind: "component-sheet" }, html: sheetHtml },
  });
  assert.equal(sheet.status, 200, sheet.text);
  assert.deepEqual(get(sheet.json, "project", "items"), [
    { kind: "component-sheet", key: "component-sheet", name: "部品帳", treatment: GLASS_TREATMENT },
  ]);

  const button = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-components", directions, GLASS_TREATMENT),
    component: { target: { kind: "component", name: "ボタン" }, html: buttonHtml },
  });
  assert.equal(button.status, 200, button.text);

  const withPage = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-components", directions, GLASS_TREATMENT),
    page: { pageType, html: pageHtml },
  });
  assert.equal(withPage.status, 200, withPage.text);
  const items = arr(get(withPage.json, "project", "items"));
  assert.deepEqual(
    items.map((item) => get(item, "kind")),
    ["component-sheet", "component", "page"],
  );
  for (const item of items) assert.deepEqual(get(item, "treatment"), GLASS_TREATMENT);

  // 部品帳を作り直しても item は 1 件のまま (中身は入れ替わる)
  const remade = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-components", directions, GLASS_TREATMENT),
    component: { target: { kind: "component-sheet" }, html: sheetHtml2 },
  });
  assert.equal(remade.status, 200, remade.text);
  const remadeItems = arr(get(remade.json, "project", "items"));
  assert.equal(remadeItems.filter((item) => get(item, "kind") === "component-sheet").length, 1);

  // GET /api/projects/<id> の items は保存の応答と同じ
  const read = await fetchPath("/api/projects/test-project-components");
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(get(read.json, "project", "items"), get(remade.json, "project", "items"));

  // 部品帳・部品は components/<key> で読める (ページと同じ CSP のヘッダー)
  const sheetRead = await fetchPath("/api/projects/test-project-components/components/component-sheet");
  assert.equal(sheetRead.status, 200, sheetRead.text);
  assert.match(sheetRead.type, /^text\/html; charset=utf-8/);
  assert.equal(sheetRead.text, sheetHtml2);
  assert.equal(sheetRead.csp, "sandbox allow-scripts");

  const buttonRead = await fetchPath("/api/projects/test-project-components/components/button");
  assert.equal(buttonRead.status, 200, buttonRead.text);
  assert.equal(buttonRead.text, buttonHtml);
  assert.equal(buttonRead.csp, "sandbox allow-scripts");

  const pageRead = await fetchPath(`/api/projects/test-project-components/pages/${pageKeyOf(pageType)}`);
  assert.equal(pageRead.status, 200, pageRead.text);
  assert.equal(sheetRead.csp, pageRead.csp);

  // 形の合わないキーと、無いキーは 404
  assert.equal((await fetchPath("/api/projects/test-project-components/components/Bad")).status, 404);
  assert.equal((await fetchPath("/api/projects/test-project-components/components/xxx")).status, 404);
});

void test("29. 部品の保存は CSP の meta が要り、page と component は同時に送れない", async () => {
  const directions = await directionsForTest();
  const noCsp = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-component-no-csp", directions, GLASS_TREATMENT),
    component: { target: { kind: "component-sheet" }, html: '<!doctype html><html lang="ja"><body>no csp</body></html>' },
  });
  assert.equal(noCsp.status, 400, noCsp.text);
  assert.equal(get(noCsp.json, "error"), "input");
  assert.equal(get(noCsp.json, "message"), "html に CSP の meta がありません");
  assert.equal((await fetchPath("/api/projects/test-project-component-no-csp")).status, 404);

  const both = await post("/api/projects", {
    project: projectVersion3ForTest("test-project-both", directions, GLASS_TREATMENT),
    page: {
      pageType: { name: "請求書一覧", family: "dashboard" },
      html: savedHtmlForTest("ページ", "<p>ページ</p>", "test-project-both"),
    },
    component: { target: { kind: "component-sheet" }, html: savedHtmlForTest("部品帳", "<p>部品帳</p>", "test-project-both") },
  });
  assert.equal(both.status, 400, both.text);
  assert.equal(get(both.json, "error"), "input");
  assert.equal(get(both.json, "message"), "page と component は同時に指定できません");
  assert.equal((await fetchPath("/api/projects/test-project-both")).status, 404);
});
