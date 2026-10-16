// 作業台の画面 (app/ui-workbench.js) のテスト。作業台はサーバーの API を fetch で呼ぶ画面なので、
// 起動や HTTP の応答ではなく、本文が使う API のパスと、見本帳からのイベントの受け取りを確かめる。
// 殻の配信は app/ui.test.ts、API の応答は app/server.test.ts が見る
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WORKBENCH_FILE = fileURLToPath(new URL("ui-workbench.js", import.meta.url));
// 作業台が使う API のパス (PBI-015 の受け入れ条件)
const API_PATHS = ["/api/directions", "/api/mix", "/api/render", "/api/page", "/api/projects", "/api/styles"];
// API の値を差し込んでよい先は srcdoc だけ (innerHTML は使わない)
const SOURCE = readFileSync(WORKBENCH_FILE, "utf8");

void test("1. 作業台が使う API のパスをすべて書いている", () => {
  for (const path of API_PATHS) {
    assert.ok(SOURCE.includes(path), `作業台に ${path} がありません`);
  }
});

void test("2. 見本帳からの studio:start-from-style のイベントを受け取る", () => {
  assert.ok(SOURCE.includes("studio:start-from-style"), "studio:start-from-style を受け取っていません");
  assert.match(SOURCE, /addEventListener\(\s*"studio:start-from-style"/, "イベントの受け取りがありません");
});

void test("3. プレビューは srcdoc で入れ、innerHTML を使わない", () => {
  assert.ok(SOURCE.includes("srcdoc"), "プレビューに srcdoc を使っていません");
  assert.ok(SOURCE.includes("sandbox"), "プレビューの iframe を sandbox で切り離していません");
  assert.ok(!SOURCE.includes("innerHTML"), "innerHTML を使っています");
});

void test("4. 「別タブで開く」用の文書は、LLM のページを sandbox の iframe で包む", () => {
  const start = SOURCE.indexOf("function wrappedPageDocument(");
  assert.ok(start >= 0, "「別タブで開く」用の包みを作る関数 (wrappedPageDocument) がありません");
  const end = SOURCE.indexOf("\n}", start);
  assert.ok(end > start, "包みを作る関数の終わりが見つかりません");
  const body = SOURCE.slice(start, end);
  assert.ok(body.includes('sandbox="allow-scripts"'), "包みの iframe に sandbox がありません");
  assert.ok(body.includes("srcdoc"), "包みの iframe に srcdoc がありません");
  assert.match(SOURCE, /wrappedPageDocument\(page\.html\)/, "「別タブで開く」用の Blob が、包んだ文書を作っていません");
  assert.ok(!body.includes("<script"), "包みにスクリプトを置いています");
  assert.ok(!body.includes("Content-Security-Policy"), "包みに CSP の meta を付けています");
  assert.ok(!SOURCE.includes("allow-same-origin"), "アプリと同じオリジンを許しています");
});
