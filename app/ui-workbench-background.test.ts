// 背景スケッチの部品 (app/sketch-host.js・app/ui-workbench-background.js) のテスト。
// 部品は sandbox の iframe の中の Worker で式を動かす画面なので、起動や HTTP の応答ではなく、
// 2 つの本文が使う API のパスと、sandbox・時間切れ・書き直しの取り決めを確かめる (PBI-008 の受け入れ条件)。
// エンジンの動きは app/sketch-engine.test.ts、API の応答は app/server.test.ts が見る。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOST_FILE = "sketch-host.js";
const PANEL_FILE = "ui-workbench-background.js";
// 部品が使う API・エンジン・host のパス
const API_PATHS = ["/api/sketches", "/api/sketch", "/app/sketch-engine.js", "/app/sketch-host.js"] as const;
const PLACEMENT_LABELS = ["ヒーローだけ", "ページ全体"] as const;
const MOTION_LABELS = ["止める", "ゆっくり動かす"] as const;

function sourceOf(name: string): string {
  const file = fileURLToPath(new URL(name, import.meta.url));
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// 名前の関数の定義から、波括弧が対応する所までの本文を取り出す (app/ui-workbench.test.ts と同じ)。
// 確かめたい書き方を「その関数の中にあるか」で見るため
function functionBodyOf(source: string, name: string): string {
  const head = `function ${name}(`;
  const from = source.indexOf(head);
  assert.notEqual(from, -1, `${name} の定義がありません`);
  const start = source.indexOf("{", from);
  let depth = 0;
  for (let at = start; at >= 0 && at < source.length; at += 1) {
    const char = source[at];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, at + 1);
    }
  }
  assert.fail(`${name} の本文の終わりが見つかりません`);
}

const HOST = sourceOf(HOST_FILE);
const PANEL = sourceOf(PANEL_FILE);

void test("1. 部品が API・エンジン・host のパスを書いている", () => {
  assert.notEqual(PANEL, "", `${PANEL_FILE} がありません`);
  for (const path of API_PATHS) {
    assert.ok(PANEL.includes(path), `部品に ${path} がありません`);
  }
});

void test("2. 2 つのファイルとも innerHTML を使わず、sandbox は allow-scripts だけ", () => {
  for (const [name, source] of [
    [HOST_FILE, HOST],
    [PANEL_FILE, PANEL],
  ] as const) {
    assert.notEqual(source, "", `${name} がありません`);
    assert.ok(!source.includes("innerHTML"), `${name} が innerHTML を使っています`);
    assert.ok(!source.includes("allow-same-origin"), `${name} が allow-same-origin を使っています`);
  }
  assert.match(PANEL, /setAttribute\("sandbox",\s*"allow-scripts"\)/, "iframe の sandbox が allow-scripts だけではありません");
});

void test("3. iframe は srcdoc で中身を入れ、host を src で読む", () => {
  assert.match(PANEL, /\.srcdoc = /, "iframe に srcdoc を入れていません");
  assert.ok(PANEL.includes('src="${'), "srcdoc の host の src がありません");
});

void test("4. 親は event.source と iframe の contentWindow を比べてから受ける", () => {
  assert.match(PANEL, /event\.source !== [A-Za-z_$][\w$]*\.contentWindow/, "event.source と iframe の contentWindow を比べていません");
});

void test("5. host は Blob の module Worker を作り、2000ms の時間切れで terminate する", () => {
  assert.match(HOST, /FRAME_TIMEOUT_MS = 2000/, "2 秒の時間切れの定数がありません");
  assert.ok(HOST.includes("new Blob("), "Worker を Blob から作っていません");
  assert.match(HOST, /type:\s*"module"/, "Worker を module として作っていません");
  const timeout = functionBodyOf(HOST, "armTimer");
  assert.match(timeout, /setTimeout\(/, "時間切れの時計がありません");
  assert.match(timeout, /kind: "timeout"/, "時間切れの合図がありません");
  assert.match(functionBodyOf(HOST, "stopWorker"), /terminate\(\)/, "時間切れで terminate していません");
});

void test("6. LLM の式は 1 フレーム試し、previous を付けて 1 回だけ書き直させる", () => {
  const posts = PANEL.match(/\/api\/sketch(?!es)/g) ?? [];
  assert.equal(posts.length, 1, "/api/sketch を 1 か所にまとめていません");
  assert.ok(functionBodyOf(PANEL, "askSketch").includes("previous"), "書き直しに previous を付けていません");
  const flow = functionBodyOf(PANEL, "generateWithLlm");
  assert.equal(flow.split("askSketch(").length - 1, 2, "書き直しが 1 回だけではありません");
  assert.ok(flow.includes("見本"), "それでもだめなときに見本を勧める文がありません");
});

void test("7. 選択肢の文言と、エラーの理由の文言を持つ", () => {
  for (const label of [...PLACEMENT_LABELS, ...MOTION_LABELS]) {
    assert.ok(PANEL.includes(label), `選択肢の文言「${label}」がありません`);
  }
  const reason = functionBodyOf(PANEL, "reasonOf");
  for (const wording of ["使えない関数", "時間切れ", "構文の誤り", "エラー: "]) {
    assert.ok(reason.includes(wording), `理由の文言「${wording}」がありません`);
  }
});

void test("8. 外したときは背景を null にし、当てる場所・動きだけの変化は焼き直さない", () => {
  const current = functionBodyOf(PANEL, "current");
  assert.match(current, /sketch: null/, "外したときに sketch を null にしていません");
  assert.match(current, /image: null/, "外したときに image を null にしていません");
  const placement = functionBodyOf(PANEL, "onPlacementChange");
  assert.ok(placement.includes("onBackgroundChange()"), "当てる場所の変化を知らせていません");
  assert.ok(!placement.includes("scheduleWork"), "当てる場所だけで焼き直しています");
  const motion = functionBodyOf(PANEL, "onMotionChange");
  assert.ok(motion.includes("onBackgroundChange()"), "動きの変化を知らせていません");
  assert.ok(!motion.includes("scheduleWork"), "動きだけで焼き直しています");
  assert.match(PANEL, /BAKE_DEBOUNCE_MS = 500/, "焼き込みを 500ms 待っていません");
});

void test("9. host は idle を受けたらタイマーを外す (描き終えて止まったスケッチを時間切れにしない)", () => {
  const handler = functionBodyOf(HOST, "onWorkerMessage");
  assert.ok(handler.includes('"idle"'), "idle を受けていません");
  assert.ok(handler.includes("clearTimer("), "idle で時間切れのタイマーを外していません");
  assert.ok(!handler.includes("stopWorker("), "idle で Worker を止めています");
});

void test("10. 部品は host の ready で initialized を戻し、init を送り直す", () => {
  const handler = functionBodyOf(PANEL, "onHostMessage");
  assert.ok(handler.includes('"ready"'), "ready を受けていません");
  assert.ok(handler.includes("initialized = false"), "ready で initialized を戻していません");
  assert.ok(handler.includes("sendInit()"), "ready で init を送り直していません");
});
