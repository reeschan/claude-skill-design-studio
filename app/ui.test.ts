// アプリの画面の殻 (app/index.html) と 3 つの画面の JS のテスト。
// サーバーを子プロセスで起動して HTTP で叩く (起動のしかたは app/server.test.ts にならう)
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOCK_LLM = join(REPO_ROOT, "app", "mock-llm.mjs");
const FAKE_STYLE_GUIDE = join(REPO_ROOT, "test", "fixtures", "fake-style-guide");
// サーバーが 1 行目に出す URL
const URL_LINE_RE = /^design-studio app: (http:\/\/127\.0\.0\.1:\d+\/)$/;
// 殻に要る画面と、そのタブのボタンの名前
const SCREENS: [string, string][] = [
  ["catalog", "台帳"],
  ["gallery", "見本帳"],
  ["workbench", "作業台"],
];
// 画面ごとの JS と、その中で使う API のパス・イベント
const SCRIPTS: [string, string[]][] = [
  ["ui-catalog", ["/api/catalog", "/api/catalog/enabled", "/api/install-plan"]],
  [
    "ui-gallery",
    ["/api/styles", "/api/gallery", "/api/themes/", "/api/treatments", "/api/motions/", "/api/motions/search", "studio:start-from-style"],
  ],
  ["ui-workbench", ["studio:start-from-style"]],
];

let child: ChildProcess | null = null;
let dir = "";
let base = "";

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
  dir = mkdtempSync(join(tmpdir(), "design-studio-ui-"));
  mkdirSync(join(dir, "gallery"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESIGN_STUDIO_HOME: join(dir, "home"),
    DESIGN_STUDIO_SKILLS_DIR: join(dir, "skills"),
    DESIGN_STUDIO_PLUGINS_DIR: join(dir, "plugins"),
    DESIGN_STUDIO_GALLERY_DIR: join(dir, "gallery"),
    STYLE_GUIDE_DIR: FAKE_STYLE_GUIDE,
    DESIGN_STUDIO_LLM_CMD: JSON.stringify([process.execPath, MOCK_LLM]),
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

type HttpResult = { status: number; type: string; text: string };

async function fetchPath(path: string): Promise<HttpResult> {
  const r = await fetch(base + path);
  const text = await r.text();
  return { status: r.status, type: r.headers.get("content-type") ?? "", text };
}

void test("1. GET / が画面の殻 (3 つの画面と 3 つのタブ) を返す", async () => {
  const index = await fetchPath("/");
  assert.equal(index.status, 200);
  assert.match(index.type, /^text\/html; charset=utf-8/);
  assert.match(index.text, /<title>design-studio<\/title>/);

  for (const [id] of SCREENS) {
    assert.ok(index.text.includes(`id="${id}"`), `id="${id}" の画面がありません`);
  }
  for (const [id, label] of SCREENS) {
    assert.match(
      index.text,
      new RegExp(`<button[^>]*data-tab="${id}"[^>]*>\\s*${label}\\s*</button>`),
      `タブ「${label}」のボタンがありません`,
    );
  }
  for (const [name] of SCRIPTS) {
    assert.match(index.text, new RegExp(`<script[^>]*type="module"[^>]*src="/app/${name}\\.js"[^>]*>`), `${name}.js を読み込んでいません`);
  }

  // 殻は起動時に /api/meta を見て、注意の帯を出す
  assert.ok(index.text.includes("/api/meta"), "殻が /api/meta を見ていません");
});

void test("2. 3 つの画面の JS が 200 で返り、使う API を書いている", async () => {
  for (const [name, needles] of SCRIPTS) {
    const js = await fetchPath(`/app/${name}.js`);
    assert.equal(js.status, 200, `${name}.js が返りません`);
    assert.match(js.type, /^text\/javascript; charset=utf-8/);
    assert.ok(js.text.length > 0, `${name}.js が空です`);
    for (const needle of needles) {
      assert.ok(js.text.includes(needle), `${name}.js に ${needle} がありません`);
    }
  }
});
