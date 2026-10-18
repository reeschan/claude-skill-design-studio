// 作業台の画面 (app/ui-workbench*.js) のテスト。作業台はサーバーの API を fetch で呼ぶ画面なので、
// 起動や HTTP の応答ではなく、本文が使う API のパスと、画面の取り決めを確かめる (PBI-009・PBI-010 の受け入れ条件)。
// 殻の配信は app/ui.test.ts、API の応答は app/server.test.ts が見る
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 作業台の本文 (PBI-010 で右のパネルと保存を分け、PBI-008 で表現の部品を分けた)。テストは 4 つを合わせて読む
const WORKBENCH_FILES = ["ui-workbench.js", "ui-workbench-panels.js", "ui-workbench-project.js", "ui-workbench-treatment.js"] as const;

function sourceOf(name: string): string {
  const file = fileURLToPath(new URL(name, import.meta.url));
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const SOURCE = WORKBENCH_FILES.map((name) => sourceOf(name)).join("\n");
// 作業台が使う API のパス
const API_PATHS = ["/api/meta", "/api/directions", "/api/mix", "/api/render"] as const;
// 右のパネルと保存が使う API のパス (PBI-010)
const PANEL_API_PATHS = ["/api/tokens", "/api/page", "/api/projects", "/pages/"] as const;
// 端末の切り替えの幅 (デスクトップ・タブレット・モバイル)
const DEVICE_WIDTHS = ["1280", "768", "375"] as const;

// 名前の関数の定義から、波括弧が対応する所までの本文を取り出す。確かめたい書き方を
// 「その関数の中にあるか」で見るため (本文全体に当てると、別の関数の同じ書き方にも一致する。PBI-010 差し戻し 1)
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

void test("1. 作業台が使う API のパスをすべて書いている", () => {
  for (const path of API_PATHS) {
    assert.ok(SOURCE.includes(path), `作業台に ${path} がありません`);
  }
});

void test("2. API の値は innerHTML に入れず、same-origin の sandbox も許していない", () => {
  assert.ok(!SOURCE.includes("innerHTML"), "innerHTML を使っています");
  assert.ok(!SOURCE.includes("allow-same-origin"), "allow-same-origin を使っています");
});

void test("3. プレビューの iframe は sandbox の srcdoc に置く", () => {
  assert.ok(SOURCE.includes("sandbox"), "プレビューの iframe を sandbox で切り離していません");
  assert.ok(SOURCE.includes("srcdoc"), "プレビューに srcdoc を使っていません");
});

void test("4. 端末の切り替えの幅 (1280・768・375) を持っている", () => {
  for (const width of DEVICE_WIDTHS) {
    assert.ok(SOURCE.includes(width), `端末の幅 ${width} がありません`);
  }
  assert.ok(SOURCE.includes("aria-pressed"), "端末の切り替えの押し下げの見た目がありません");
});

void test("5. 見本帳からの studio:start-from-style のイベントを受け取る", () => {
  assert.ok(SOURCE.includes("studio:start-from-style"), "studio:start-from-style を受け取っていません");
  assert.match(SOURCE, /addEventListener\(\s*"studio:start-from-style"/, "イベントの受け取りがありません");
});

void test("6. 画面の種類の候補に datalist を使う", () => {
  assert.ok(SOURCE.includes("datalist"), "画面の種類に datalist を使っていません");
});

void test("7. 編集の影の選択は案の種 (seed) の shape.shadow を読む", () => {
  // 影は seed の直下ではなく shape の中にある (core/types.ts)。直下を読むと選択が空になり、保存が必ず 400 になる
  assert.ok(SOURCE.includes("record(seed.shape).shadow"), "影の選択が seed.shape.shadow を読んでいません");
  assert.ok(!SOURCE.includes("text(seed.shadow)"), "影の選択が種の直下の shadow を読んでいます");
});

void test("8. 編集のフォームと保存は編集後の案 (edits) を元にする", () => {
  // 原案 (drafts) を直接読むと、編集ずみの案を開き直したときに前の編集が消える
  assert.ok(!SOURCE.includes("record(round.drafts[index])"), "編集が原案 (drafts) を直接読んでいます");
  assert.match(SOURCE, /edits\[index\] \?\? round\.drafts\[index\]/, "編集後の案 (edits) を優先する読み方がありません");
});

void test("9. 右のパネルと保存の本文がそろっている (PBI-010 で分けたファイル)", () => {
  for (const name of WORKBENCH_FILES) {
    assert.notEqual(sourceOf(name), "", `${name} がありません`);
  }
});

void test("10. パッド・微調整・ページ・保存の API のパスを書いている", () => {
  for (const path of PANEL_API_PATHS) {
    assert.ok(SOURCE.includes(path), `作業台に ${path} がありません`);
  }
});

void test("11. 点と微調整は画面で計算せず、そのまま /api/mix に送る", () => {
  // /api/mix を呼ぶ関数の本文に限って確かめる (本文全体に当てると、保存の処理などの同じ書き方に一致して素通りする)
  const mix = functionBodyOf(sourceOf("ui-workbench.js"), "mixRound");
  assert.ok(mix.includes("/api/mix"), "案を混ぜるところに /api/mix がありません");
  assert.match(mix, /points:\s*state\.points/, "点を state.points のまま送っていません");
  assert.match(mix, /fineTune:\s*state\.fineTune/, "微調整を state.fineTune のまま送っていません");
  // パッドの点は 0〜1 の x, y をそのまま送る。重みの計算 (双一次の式) は core/direction.ts だけにある (ADR 0003)
  const bilinear = /\(\s*1\s*-\s*[A-Za-z_$][\w$]*\s*\)\s*\*\s*\(\s*1\s*-\s*[A-Za-z_$][\w$]*\s*\)/;
  assert.ok(!bilinear.test(SOURCE), "画面で重みの計算 (双一次の式) をしています");
  assert.ok(!SOURCE.includes("padWeights"), "画面で重みの計算を書いています");
});

void test("12. 「別タブで開く」は wrappedPageDocument で sandbox の iframe に包む", () => {
  assert.match(SOURCE, /wrappedPageDocument\(\s*page\.html\s*\)/, "wrappedPageDocument(page.html) を使っていません");
  assert.ok(SOURCE.includes('sandbox="allow-scripts"'), "包みの iframe に sandbox がありません");
});

void test("13. パッドの点はポインターのドラッグと矢印キーで動かせる", () => {
  assert.ok(SOURCE.includes("pointerdown"), "パッドにポインターの操作がありません");
  assert.ok(SOURCE.includes("setPointerCapture"), "ドラッグでポインターをつかんでいません");
  assert.match(SOURCE, /ArrowLeft/, "矢印キー (左) の操作がありません");
  assert.match(SOURCE, /ArrowDown/, "矢印キー (下) の操作がありません");
});

void test("14. 保存とページを作る処理は、案の世代を進めない", () => {
  // 保存やページ作りが案の世代 (state.session) を進めると、出している途中の案やページの応答が知らせなしに捨てられる
  // (PBI-010 差し戻し 1)。連打は busy の印で防ぐ
  const project = sourceOf("ui-workbench-project.js");
  for (const name of ["createPage", "saveProject"]) {
    const body = functionBodyOf(project, name);
    assert.ok(!body.includes("nextSession"), `${name} が案の世代を進めています`);
    assert.ok(!body.includes("state.session"), `${name} が案の世代で応答を捨てています`);
  }
});

void test("15. 案を出し直したら、前のプロジェクトのページの一覧も捨てる", () => {
  // projectId だけを捨てると、前のキーのままのページが新しい id で 404 になる (PBI-010 差し戻し 1)
  const body = functionBodyOf(sourceOf("ui-workbench.js"), "acceptGeneration");
  assert.match(body, /state\.projectId\s*=\s*null/, "新しい案でプロジェクトを捨てていません");
  assert.match(body, /discardPages\(\)/, "前のプロジェクトのページの一覧を捨てていません");
  const discard = functionBodyOf(sourceOf("ui-workbench-project.js"), "discardPages");
  assert.match(discard, /state\.pageList\s*=\s*\[\]/, "ページの一覧が残ります");
  assert.match(discard, /state\.page\s*=\s*null/, "今のページが残ります");
});

void test("16. トークンは、要求したときと今の見た目が違えば捨てる", () => {
  // 待っている間にパッドや微調整で見た目が変わったら、古い応答は出さない・覚えない (PBI-010 差し戻し 1)
  const body = functionBodyOf(sourceOf("ui-workbench-panels.js"), "ensureTokens");
  assert.ok(body.includes("/api/tokens"), "トークンの読み込みに /api/tokens がありません");
  assert.match(body, /text\(record\(state\.tuned\)\.id\) !== id/, "返ってきたときに、今の見た目の id と比べていません");
  assert.match(body, /!==\s*id\)\s*(?:\{\s*)?return null/, "古いトークンを捨てていません (出さない・覚えない)");
});

void test("17. 保存は、まだ保存していないページを 1 枚ずつ全部送る", () => {
  // 画面の種類を変えて 2 枚作ってから保存しても、両方がプロジェクトに入る (PR #1 のレビュー)
  const source = sourceOf("ui-workbench-project.js");
  const save = functionBodyOf(source, "saveProject");
  assert.match(save, /unsavedPages\(\)/, "保存がまだのページを集めていません");
  assert.match(save, /for \(const entry of pending\.slice\(1\)\)/, "2 枚目以降のページを送っていません");
  assert.match(functionBodyOf(source, "upsertPage"), /dirty: true/, "作ったページに保存がまだの印を付けていません");
  assert.match(functionBodyOf(source, "postProject"), /entry\.dirty = false/, "保存できたページの印を外していません");
});

void test("18. スタイルから始めたら、開いていたプロジェクトの id とページの一覧を捨てる", () => {
  // 開いたプロジェクトに、スタイルの回 1 つだけを上書き保存しない (PR #1 のレビュー)
  const body = functionBodyOf(sourceOf("ui-workbench.js"), "beginFromStyle");
  assert.match(body, /state\.projectId = null/, "プロジェクトの id が残ります");
  assert.match(body, /projectPanel\.discardPages\(\)/, "前のプロジェクトのページの一覧が残ります");
});

void test("19. 表現の部品は /api/treatments から面と動きの見本を読み、動きは /api/motions/ の見本で見せる", () => {
  // 面の台帳と動きの見本集はサーバーが返す (PBI-008)。読めないときは「指定しない」「なし」だけで動く
  const treatment = sourceOf("ui-workbench-treatment.js");
  assert.ok(treatment.includes("createTreatmentPanel"), "createTreatmentPanel を export していません");
  assert.ok(treatment.includes("/api/treatments"), "面と動きの一覧を /api/treatments から読んでいません");
  assert.ok(treatment.includes("/api/motions/"), "動きの見本を /api/motions/ から開いていません");
  // iframe は「動きを見る」を押したときだけ作る (12 枚を一度に動かさない)
  assert.ok(treatment.includes("src = `/api/motions/"), "動きの見本の iframe の src がありません");
});

void test("20. 依頼・骨組みのプレビュー・ページの body にいまの表現を入れる", () => {
  // 案を出す・骨組みを描く・ページを作るの 3 つが同じ表現を使う (PBI-008)
  const directions = functionBodyOf(sourceOf("ui-workbench.js"), "generateFromForm");
  assert.ok(directions.includes("/api/directions"), "案を出す関数に /api/directions がありません");
  assert.match(directions, /treatment:\s*state\.treatment/, "案を出す body に treatment がありません");

  const render = functionBodyOf(sourceOf("ui-workbench.js"), "requestRender");
  assert.ok(render.includes("/api/render"), "骨組みを描く関数に /api/render がありません");
  assert.match(render, /treatment:\s*state\.treatment/, "骨組みを描く body に treatment がありません");

  const page = functionBodyOf(sourceOf("ui-workbench-project.js"), "createPage");
  assert.ok(page.includes("/api/page"), "ページを作る関数に /api/page がありません");
  assert.match(page, /treatment:\s*state\.treatment/, "ページを作る body に treatment がありません");
});

void test("21. 保存は版 3 で表現を送り、開き直しは treatment と items を読む", () => {
  const project = sourceOf("ui-workbench-project.js");
  const save = functionBodyOf(project, "projectForSave");
  assert.match(save, /version:\s*3/, "保存の body が版 3 ではありません");
  assert.match(save, /treatment:\s*state\.treatment/, "保存の body に treatment がありません");

  const apply = functionBodyOf(sourceOf("ui-workbench.js"), "applyProject");
  assert.match(apply, /project\.treatment/, "開き直しで project.treatment を読んでいません");
  assert.match(apply, /project\.items/, "開き直しで project.items を読んでいません");
});

void test("22. 表現の部品も innerHTML を使わず、動きの見本も allow-scripts だけの sandbox で開く", () => {
  const treatment = sourceOf("ui-workbench-treatment.js");
  assert.ok(!treatment.includes("innerHTML"), "表現の部品が innerHTML を使っています");
  assert.ok(!treatment.includes("allow-same-origin"), "表現の部品が allow-same-origin を使っています");
  assert.match(treatment, /setAttribute\("sandbox",\s*"allow-scripts"\)/, "動きの見本の iframe の sandbox がありません");
});

void test("23. 動きの見本のチェックは 4 件までに止める", () => {
  // 5 件目は選べない (core の validateTreatment と同じ上限)
  const treatment = sourceOf("ui-workbench-treatment.js");
  assert.match(treatment, /SAMPLE_MAX\s*=\s*4/, "見本の上限の値 (4) がありません");
  assert.ok(treatment.includes("length >= SAMPLE_MAX"), "上限に達したらチェックを止めていません");
});
