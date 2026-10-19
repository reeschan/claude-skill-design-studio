// 作業台の画面 (app/ui-workbench*.js) のテスト。作業台はサーバーの API を fetch で呼ぶ画面なので、
// 起動や HTTP の応答ではなく、本文が使う API のパスと、画面の取り決めを確かめる (PBI-009・PBI-010 の受け入れ条件)。
// 殻の配信は app/ui.test.ts、API の応答は app/server.test.ts が見る
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 作業台の本文 (PBI-010 で右のパネルと保存を分け、PBI-008 で表現の部品、PBI-009 で背景スケッチの部品を分けた)。
// テストは 5 つを合わせて読む
const WORKBENCH_FILES = [
  "ui-workbench.js",
  "ui-workbench-panels.js",
  "ui-workbench-project.js",
  "ui-workbench-treatment.js",
  "ui-workbench-background.js",
] as const;

function sourceOf(name: string): string {
  const file = fileURLToPath(new URL(name, import.meta.url));
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const SOURCE = WORKBENCH_FILES.map((name) => sourceOf(name)).join("\n");
// 作業台が使う API のパス
const API_PATHS = ["/api/meta", "/api/directions", "/api/mix", "/api/render"] as const;
// 右のパネルと保存が使う API のパス (PBI-010・PBI-006)
const PANEL_API_PATHS = ["/api/tokens", "/api/projects", "/pages/"] as const;
// 部品の候補の名前 (core/types.ts の COMPONENT_CANDIDATES と同じ 10 個。並びもこのとおり)
const COMPONENT_NAMES = [
  "ボタン",
  "入力欄",
  "カード",
  "ヘッダーのナビ",
  "タブ",
  "バッジ/タグ",
  "モーダル",
  "トースト",
  "表",
  "料金カード",
] as const;
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
  for (const name of ["createMake", "saveProject"]) {
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

void test("17. 保存は、まだ保存していないものを 1 件ずつ全部送る", () => {
  // 画面の種類を変えて 2 枚作ってから保存しても、両方がプロジェクトに入る (PR #1 のレビュー・PBI-006)
  const source = sourceOf("ui-workbench-project.js");
  const save = functionBodyOf(source, "saveProject");
  assert.match(save, /unsavedEntries\(\)/, "保存がまだのものを集めていません");
  assert.match(save, /for \(const entry of pending\.slice\(1\)\)/, "2 件目以降を送っていません");
  assert.match(functionBodyOf(source, "upsertEntry"), /dirty: true/, "作ったものに保存がまだの印を付けていません");
  assert.match(functionBodyOf(source, "postProject"), /entry\.dirty = false/, "保存できたものの印を外していません");
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
  // 見本はダイアログで選び、動く見本は選んでいる 1 件だけを出す (12 枚を一度に動かさない)。
  // sandbox の iframe の src では描かれないブラウザ (Claude のブラウザのペイン) があるため、
  // 骨組みのプレビューと同じく HTML を読んで srcdoc に入れる
  assert.ok(treatment.includes('createElement("dialog")'), "動きの見本を選ぶダイアログがありません");
  assert.ok(treatment.includes("showModal()"), "ダイアログをモーダルで開いていません");
  const preview = functionBodyOf(treatment, "showSamplePreview");
  assert.ok(preview.includes("`/api/motions/"), "動きの見本の HTML を /api/motions/ から読んでいません");
  assert.ok(preview.includes(".srcdoc = "), "動きの見本を srcdoc に入れていません");
  assert.ok(!treatment.includes(".src = "), "動きの見本の iframe に src を使っています");
});

void test("20. 依頼・骨組みのプレビュー・作るものの body にいまの表現を入れる", () => {
  // 案を出す・骨組みを描く・作るものを作るの 3 つが同じ表現を使う (PBI-008・PBI-006)
  const directions = functionBodyOf(sourceOf("ui-workbench.js"), "generateFromForm");
  assert.ok(directions.includes("/api/directions"), "案を出す関数に /api/directions がありません");
  assert.match(directions, /treatment:\s*state\.treatment/, "案を出す body に treatment がありません");

  const render = functionBodyOf(sourceOf("ui-workbench.js"), "requestRender");
  assert.ok(render.includes("/api/render"), "骨組みを描く関数に /api/render がありません");
  assert.match(render, /treatment:\s*state\.treatment/, "骨組みを描く body に treatment がありません");

  const make = functionBodyOf(sourceOf("ui-workbench-project.js"), "createMake");
  assert.ok(make.includes("/api/generate"), "作るものを作る関数に /api/generate がありません");
  assert.match(make, /make,/, "作るものを作る body に make がありません");
  assert.match(make, /treatment:\s*state\.treatment/, "作るものを作る body に treatment がありません");
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

void test("24. 作るものは /api/generate で作り、作業台は /api/page を使わない", () => {
  // ページ・部品帳・部品の生成を 1 つの API にそろえる (contract.md の 7・8 節)
  assert.match(
    functionBodyOf(sourceOf("ui-workbench-project.js"), "createMake"),
    /\/api\/generate/,
    "作るものの生成に /api/generate を使っていません",
  );
  for (const name of WORKBENCH_FILES) {
    assert.ok(!sourceOf(name).includes("/api/page"), `${name} が /api/page を使っています`);
  }
});

void test("25. 部品帳・部品の読み出しは /components/ の経路を使う", () => {
  // ページは /pages、部品帳・部品は /components から読む (contract.md の 8 節)
  const path = functionBodyOf(sourceOf("ui-workbench-project.js"), "entryPathOf");
  assert.ok(path.includes("/pages/"), "ページの読み出しに /pages/ がありません");
  assert.ok(path.includes("/components/"), "部品帳・部品の読み出しに /components/ がありません");
  assert.match(path, /entry\.kind === "page"/, "ページと部品帳・部品で経路を分けていません");
});

void test("26. 作るものの kind (component-sheet / component) を送る値として持つ", () => {
  // 生成は make、保存は component.target に作るものを入れる (contract.md の 7・8 節)
  const project = sourceOf("ui-workbench-project.js");
  const make = functionBodyOf(project, "currentMake");
  assert.ok(make.includes('kind: "component-sheet"'), "部品帳の kind を送っていません");
  assert.ok(make.includes('kind: "component"'), "部品の kind を送っていません");
  assert.match(functionBodyOf(project, "createMake"), /make,/, "作るものを make として送っていません");
  assert.match(functionBodyOf(project, "postProject"), /body\.component = \{ target:/, "部品帳・部品を component として保存していません");
});

void test("27. 部品の候補 10 個の名前をソースに持つ", () => {
  // JS は core を import できないので、core/types.ts の COMPONENT_CANDIDATES と同じ並びをこのファイルに持つ
  const project = sourceOf("ui-workbench-project.js");
  const start = project.indexOf("const COMPONENT_CANDIDATES");
  assert.notEqual(start, -1, "部品の候補の定数がありません");
  const block = project.slice(start, project.indexOf("];", start));
  for (const name of COMPONENT_NAMES) {
    assert.ok(block.includes(`name: "${name}"`), `部品の候補「${name}」がありません`);
  }
});

void test("28. 開き直しは items の 3 つの kind を一覧に戻し、見出しは部品帳・部品でも名前を出す", () => {
  // 保存したプロジェクトを開き直すと、ページ・部品帳・部品が一覧に戻る (contract.md の 8 節)
  const entries = functionBodyOf(sourceOf("ui-workbench.js"), "pageEntriesOf");
  for (const kind of ["page", "component-sheet", "component"]) {
    assert.ok(entries.includes(`"${kind}"`), `開き直しが ${kind} を一覧に戻していません`);
  }
  const draw = functionBodyOf(sourceOf("ui-workbench.js"), "drawPagePreview");
  assert.match(draw, /page\.kind/, "プレビューの見出しが作ったものの種類を見ていません");
  assert.match(draw, /record\(page\.pageType\)\.name/, "プレビューの見出しが名前を出していません");
});

void test("29. 作るものの選択肢にデザインガイドを持つ", () => {
  // 「デザインガイド」を選ぶと make に design-guide を送り、ボタンは「デザインガイドを作る」になる (contract.md の 8 節)
  const project = sourceOf("ui-workbench-project.js");
  const start = project.indexOf("const MAKE_OPTIONS");
  assert.notEqual(start, -1, "作るものの選択肢の定数がありません");
  const block = project.slice(start, project.indexOf("];", start));
  assert.ok(block.includes('value: "design-guide"'), "作るものの選択肢に design-guide がありません");
  assert.ok(block.includes('label: "デザインガイド"'), "作るものの選択肢の表示が「デザインガイド」ではありません");
  assert.ok(functionBodyOf(project, "currentMake").includes('kind: "design-guide"'), "生成に design-guide の kind を送っていません");
  assert.ok(functionBodyOf(project, "kindLabel").includes('"デザインガイド"'), "ボタンの文言にデザインガイドがありません");
});

void test("30. デザインガイドの読み出しは /design-guide/ の 3 つのファイルを使い、保存は designGuide で送る", () => {
  // 開き直しは /api/projects/<id>/design-guide/<name> から読む。保存は designGuide: {files} で送る (contract.md の 8 節)
  const project = sourceOf("ui-workbench-project.js");
  assert.ok(functionBodyOf(project, "guidePathOf").includes("/design-guide/"), "デザインガイドの読み出しのパスがありません");
  assert.ok(functionBodyOf(project, "entryPathOf").includes("component-sheet.html"), "部品帳の HTML のパスがありません");
  const start = project.indexOf("const DESIGN_GUIDE_FILES");
  assert.notEqual(start, -1, "デザインガイドのファイルの定数がありません");
  const block = project.slice(start, project.indexOf("];", start));
  for (const name of ["component-sheet.html", "design-guide.md", "style-guide.md"]) {
    assert.ok(block.includes(`"${name}"`), `デザインガイドの ${name} の読み出しがありません`);
  }
  assert.match(functionBodyOf(project, "postProject"), /body\.designGuide = \{ files:/, "保存の本文に designGuide がありません");
});

void test("31. 応答の designGuideDir を保存先に出し、古い style-guide のときは notice を出す", () => {
  // 保存の応答の designGuideDir を「保存先: <パス>」に、生成の応答の notice を古い style-guide の案内に使う
  const project = sourceOf("ui-workbench-project.js");
  assert.ok(functionBodyOf(project, "postProject").includes("designGuideDir"), "保存の応答の designGuideDir を使っていません");
  const payload = functionBodyOf(project, "guideOfPayload");
  assert.ok(payload.includes("payload.designGuide"), "生成の応答の designGuide を読んでいません");
  assert.ok(payload.includes("notice"), "生成の応答の notice を使っていません");
  const render = functionBodyOf(project, "renderGuide");
  assert.match(render, /styleGuide\) === "outdated"/, "古い style-guide の分岐がありません");
  assert.ok(render.includes("guideNoticeOf"), "古い style-guide の案内を出していません");
  assert.ok(render.includes("保存先"), "保存先を出していません");
  assert.ok(functionBodyOf(project, "guideNoticeOf").includes("guide.notice"), "notice の文言を使っていません");
});

void test("32. 開き直したデザインガイドは部品帳と文書を読み、文書が 404 なら古い style-guide として扱う", () => {
  // design-guide.md が無いときは outdated にして notice を出し、保存し直すのは読めたファイルだけにする
  const project = sourceOf("ui-workbench-project.js");
  assert.match(functionBodyOf(project, "readGuideFileOrNull"), /status === 404/, "404 を古い style-guide として扱っていません");
  assert.match(functionBodyOf(project, "guideOfFiles"), /outdated \? "outdated" : "ok"/, "outdated の判定がありません");
  assert.ok(functionBodyOf(project, "restoreDesignGuide").includes('"design-guide"'), "開き直しがデザインガイドを一覧に戻していません");
});

void test("33. 作業台は背景スケッチの部品を右の列に置き、/api/background/apply で差し込む", () => {
  // 部品 (PBI-008) は /api/background/apply ではなく、ページへの差し込みは作業台が行う (contract.md の 6 節)
  const workbench = sourceOf("ui-workbench.js");
  assert.match(
    workbench,
    /import \{ createBackgroundPanel \} from "\.\/ui-workbench-background\.js"/,
    "背景スケッチの部品を import していません",
  );
  assert.match(functionBodyOf(workbench, "buildSidePanels"), /createBackgroundPanel\(/, "右の列に背景スケッチの部品を置いていません");
  assert.ok(functionBodyOf(workbench, "panelContext").includes("onBackgroundChange"), "部品に onBackgroundChange を渡していません");
  assert.ok(workbench.includes("/api/background/apply"), "背景の差し込みに /api/background/apply を使っていません");
  const apply = functionBodyOf(workbench, "applyBackgroundTo");
  assert.match(apply, /backgroundApplyOf\(\)/, "差し込む背景を部品から読んでいません");
  assert.match(apply, /JSON\.stringify\(body\)/, "差し込みの本文を送っていません");
});

void test("34. 骨組みのプレビューと作ったページは、背景を差し込んでから srcdoc に入れる", () => {
  // 焼き込んだ画像を当てるのは srcdoc に入れる前。ページの html は差し込み直したものを state.page.html に戻す (58)
  const workbench = sourceOf("ui-workbench.js");
  const skeleton = functionBodyOf(workbench, "paintSkeleton");
  assert.match(skeleton, /applyBackgroundTo\(/, "骨組みに背景を差し込んでいません");
  assert.match(skeleton, /\.srcdoc = /, "差し込んだ骨組みを srcdoc に入れていません");
  assert.match(functionBodyOf(workbench, "paintFrame"), /paintSkeleton\(/, "骨組みの描画が背景の差し込みを通っていません");
  const page = functionBodyOf(workbench, "drawPagePreview");
  assert.match(page, /applyBackgroundTo\(/, "作ったページに背景を差し込んでいません");
  assert.match(page, /\.srcdoc = /, "差し込んだページを srcdoc に入れていません");
  assert.match(page, /page\.html/, "ページの html を差し込み直していません");
});

void test("35. /api/render の応答の palette を背景スケッチの部品の setPalette に渡す", () => {
  // テーマの色が変わったら焼き直す (53)。palette は /api/render の応答にだけ入っている (contract.md の 5 節)
  const draw = functionBodyOf(sourceOf("ui-workbench.js"), "drawFrame");
  assert.match(draw, /setPalette\(/, "応答の palette を部品に渡していません");
  assert.match(draw, /palette/, "応答の palette を読んでいません");
});

void test("36. 保存は背景スケッチを送り、開き直しは project.background を部品に戻す", () => {
  // 保存の本文の project に background を入れ、開き直しで部品に戻す (44)
  const save = functionBodyOf(sourceOf("ui-workbench-project.js"), "projectForSave");
  assert.match(save, /background:/, "保存の本文に background がありません");
  const apply = functionBodyOf(sourceOf("ui-workbench.js"), "applyProject");
  assert.match(apply, /project\.background/, "開き直しで project.background を読んでいません");
  assert.match(apply, /setBackground\(/, "開き直しで背景を部品に戻していません");
});
