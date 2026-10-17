// 作業台の画面 (1 画面の 3 列)。左に依頼のフォームと案の一覧 (回の切り替え・編集・原案に戻す)、
// 中央に端末を切り替えられるライブプレビュー (骨組み / ページ)、右に調整のパネル
//   (パッド・微調整・コントラスト・トークン・ページ・保存。PBI-010 で下の 2 つのファイルに分けた)。
// 見本帳の「これに近いもので作る」から studio:start-from-style を受けたら、そのスタイルを原案 1 つの回にして始める。
// API: GET /api/meta /api/styles /api/projects、POST /api/directions /api/mix /api/render /api/tokens /api/page /api/projects
import { createPanels } from "./ui-workbench-panels.js";
import { createProjectPanel } from "./ui-workbench-project.js";

const LETTERS = ["A", "B", "C", "D"];
// 骨組みの種類 (core と同じ 7 つ)。候補の並びは /api/meta の pageTypes に合わせる
const SKELETON_FAMILIES = ["lp", "dashboard", "blog", "pricing", "product", "portfolio", "settings"];
const SHADOWS = [
  { value: "none", label: "なし" },
  { value: "soft", label: "柔らかい" },
  { value: "hard", label: "はっきり" },
];
const BASE_MODES = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];
// /api/meta が読めないときの候補と配置の型 (core/types.ts の候補・LAYOUTS と同じ)
const FALLBACK_CANDIDATES = [
  { name: "LP", family: "lp" },
  { name: "ダッシュボード", family: "dashboard" },
  { name: "ブログ記事", family: "blog" },
  { name: "料金ページ", family: "pricing" },
  { name: "商品詳細", family: "product" },
  { name: "ポートフォリオ", family: "portfolio" },
  { name: "設定画面", family: "settings" },
];
const FALLBACK_LAYOUTS = {
  lp: ["centered", "split", "fullbleed"],
  dashboard: ["sidebar", "topnav", "cards"],
  blog: ["classic", "magazine", "minimal"],
  pricing: ["tiers", "table", "spotlight"],
  product: ["split", "gallery", "story"],
  portfolio: ["grid", "list", "showcase"],
  settings: ["sidebar", "tabs", "stacked"],
};
// プレビューの端末の切り替え。幅は骨組みが面する幅
const DEVICES = [
  { key: "desktop", label: "デスクトップ", width: 1280 },
  { key: "tablet", label: "タブレット", width: 768 },
  { key: "mobile", label: "モバイル", width: 375 },
];
const FRAME_HEIGHT = 800;
// 連打をまとめる待ち時間。編集の保存や配置の選び直しのあとの描き直しも、ここで 1 回にする
const SEND_DELAY_MS = 300;
const SHOT_MAX_BYTES = 5 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg"];
const JSON_HEADERS = { "Content-Type": "application/json" };
// 混ぜる軸ごとの点。最初は 4 軸とも案 A の隅 (0, 0)
const POINTS_A = { color: { x: 0, y: 0 }, font: { x: 0, y: 0 }, shape: { x: 0, y: 0 }, layout: { x: 0, y: 0 } };
// 中央のプレビューの切り替え (骨組み / ページ)
const PREVIEW_VIEWS = [
  { key: "skeleton", label: "骨組み" },
  { key: "page", label: "ページ" },
];
// 作業台だけの CSS。共通の CSS (ボタン・seg・status など) は殻 (app/index.html) にある
const WORKBENCH_CSS = `
.wb-section { min-width: 0; margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
.wb-section h3 { margin: 0 0 6px; font-size: 16px; font-weight: 700; }
.wb-section h3::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 1px; background: var(--marker); vertical-align: 0.1em; }
.wb-col [hidden] { display: none; }
.wb-col { min-width: 0; }
.wb-note { margin: 6px 0; font-size: 13px; color: var(--muted); }
.wb-form { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wb-field { display: flex; flex-direction: column; gap: 2px; }
.wb-caption { font-size: 12.5px; font-weight: 700; color: var(--muted); }
.wb-input { width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); font: inherit; transition: border-color 0.15s; }
.wb-input:hover { border-color: color-mix(in oklch, var(--primary) 45%, var(--line)); }
.wb-input:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; border-color: transparent; }
textarea.wb-input { resize: vertical; min-height: 54px; }
select.wb-input { width: auto; }
.wb-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.wb-round-bar { margin: 8px 0 0; }
.wb-cards { display: grid; gap: 10px; margin: 10px 0 0; }
.wb-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); transition: border-color 0.15s; }
.wb-card:hover { border-color: color-mix(in oklch, var(--primary) 55%, var(--line)); }
.wb-card-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wb-card h4 { margin: 0; font-size: 14.5px; overflow-wrap: anywhere; }
.wb-card-rationale { margin: 0; font-size: 13px; color: var(--muted); }
.wb-letter { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--radius-sm); background: var(--gradient); color: var(--primary-foreground); font-family: var(--font-heading); font-size: 13px; font-weight: 700; }
.wb-edited { padding: 0 9px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-soft-fg); font-family: var(--font-mono); font-size: 11px; font-weight: 500; }
.wb-check { display: inline-flex; gap: 4px; align-items: center; font-size: 13px; }
.wb-editor { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; border-top: 1px dashed var(--line); }
.wb-group { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.wb-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 12px; }
.wb-items { display: grid; gap: 6px; }
.wb-item { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px dashed var(--line); border-radius: 6px; }
.wb-shot { max-width: 100%; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.wb-frame { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; box-shadow: var(--shadow); }
.wb-frame iframe { display: block; border: 0; transform-origin: top left; /* pointer-events は付けない (プレビューの中をスクロールできるように) */ }
`;

// 画面の状態。描画はすべてここから行う (DOM を作る処理と、状態を変える処理は分ける)
const state = {
  status: null, // 殻の状態文 (#wb-status)
  columns: { brief: null, stage: null, panels: null }, // 3 列の入れ物 (殻)
  meta: null, // /api/meta の応答 (画面の種類の候補・配置の型・フォントの組)
  form: null, // 依頼フォームの各要素
  familyRow: null, // 自由な名前のときに出す「骨組み」の行
  familySelect: null, // 骨組みの種類の選び直し
  roundBar: null, // 回の切り替えのボタンの置き場
  cards: null, // 案のカードの置き場
  printAgain: null, // 「案を出し直す」
  deviceSeg: null, // 端末の切り替え
  viewSeg: null, // プレビューの切り替え (骨組み / ページ)
  stageNote: null, // プレビューの状態
  frameBox: null, // プレビューの枠
  frame: null, // プレビューの iframe
  pageType: { name: "", family: "" }, // 画面の種類 (骨組みの種類は応答で決まる)
  rounds: [], // 回の一覧 { drafts, edits }
  roundIndex: -1, // いまの回
  points: structuredClone(POINTS_A), // パッドの点 (右の列が動かす)
  fineTune: {}, // 微調整 (右の列が作る。空 = 混ぜた値のまま)
  device: "desktop", // プレビューの端末
  previewMode: "skeleton", // 中央のプレビュー (骨組み / ページ)
  mixed: null, // 最後の /api/mix の mixed (混ぜただけ。微調整の初期値に使う)
  tuned: null, // 最後の /api/mix の direction (微調整込み。トークンとページに使う)
  page: null, // 中央に出しているページ { pageType, html }
  pageList: [], // 画面の種類ごとに作ったページ { name, family, key, html }
  pageOpenUrl: null, // 「別タブで開く」の Blob の URL (次に開くときに捨てる)
  projectId: null, // 保存したプロジェクトの id
  screenshot: null, // { name, dataUrl }
  editing: -1, // 編集中の案の添字。無いときは -1
  generating: false, // 案を出している間
  savingEdit: false, // 案の編集を確かめている間
  session: 0, // 作業の世代 (新しい作業のたびに 1 進め、あとから始まった作業より古い応答は捨てる)
  previewToken: 0, // プレビューの世代 (古い応答を捨てる)
  timer: 0, // 連打をまとめるタイマー
};

// 右の列のパッド・微調整・コントラスト・トークン (app/ui-workbench-panels.js)
let panels = null;

// 右の列のページ・保存 (app/ui-workbench-project.js)
let projectPanel = null;

const frameObserver = new ResizeObserver(() => {
  sizeFrame();
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className !== null && className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const text = (value) => (typeof value === "string" ? value : "");

const record = (value) => (value !== null && typeof value === "object" ? value : {});

const numberOf = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

// いま進めている作業の世代を 1 進める
function nextSession() {
  state.session += 1;
  return state.session;
}

async function requestJson(path, options) {
  const res = await fetch(path, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = text(record(body).message);
    throw new Error(message === "" ? `HTTP ${String(res.status)}` : message);
  }
  return body;
}

// 保存したページ (HTML) を読む
async function requestText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return await res.text();
}

function setNote(element, message, isError) {
  if (element === null) return;
  element.textContent = message;
  element.classList.toggle("status-error", isError === true);
}

function setStatus(message, isError) {
  setNote(state.status, message, isError);
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${String(seconds)} 秒`;
  return `${String(Math.floor(seconds / 60))} 分 ${String(seconds % 60)} 秒`;
}

// 経過時間を 1 秒ごとに出す。戻り値の関数で止める
function startElapsed(element, label) {
  const started = Date.now();
  const tick = () => {
    const seconds = Math.round((Date.now() - started) / 1000);
    setNote(element, `${label} (経過 ${formatElapsed(seconds)})`, false);
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => {
    clearInterval(timer);
  };
}

// /api/meta の値。読めていなければ同内容の手前の候補に置き換える
function pageTypeCandidates() {
  const candidates = record(state.meta).pageTypes;
  return Array.isArray(candidates) && candidates.length > 0 ? candidates : FALLBACK_CANDIDATES;
}

function layoutsOf(family) {
  const layouts = record(record(state.meta).layouts)[family];
  const known = Array.isArray(layouts) && layouts.length > 0;
  return known ? layouts : (FALLBACK_LAYOUTS[family] ?? []);
}

function fontPairs() {
  const pairs = record(state.meta).fontPairs;
  return Array.isArray(pairs) ? pairs : [];
}

// 骨組みの種類の名前 (候補の名前を借りる)。知らない種類はそのまま帰す
function familyLabel(family) {
  const matched = pageTypeCandidates().find((candidate) => record(candidate).family === family);
  return matched === undefined ? family : text(record(matched).name);
}

const deviceOf = (key) => DEVICES.find((device) => device.key === key) ?? DEVICES[0];

// 表示中の回。案を出す前に戻す
const currentRound = () => state.rounds[state.roundIndex] ?? null;

const freshPoints = () => structuredClone(POINTS_A);

// 編集の元にする案 = 編集後があればそれ、無ければ原案 (原案は書き換えない)
function editBaseOf(round, index) {
  return record(round.edits[index] ?? round.drafts[index]);
}

// 効いてくる案 = 編集後があればそれ、無ければ原案
function effectiveDirections(round) {
  return round.drafts.map((_, index) => editBaseOf(round, index));
}

function switchToWorkbench() {
  const tab = document.querySelector('button[data-tab="workbench"]');
  if (tab !== null) tab.click();
}

// ---------------------------------------------------------------- 依頼のフォーム

function fieldOf(caption, control) {
  const label = el("label", "wb-field");
  label.append(el("span", "wb-caption", caption), control);
  return label;
}

function textInputOf(value, maxLength, placeholder) {
  const input = document.createElement("input");
  input.className = "wb-input";
  input.maxLength = maxLength;
  input.value = value;
  if (placeholder !== undefined) input.placeholder = placeholder;
  return input;
}

function textareaOf(value, rows, maxLength) {
  const item = document.createElement("textarea");
  item.className = "wb-input";
  item.rows = rows;
  item.maxLength = maxLength;
  item.value = value;
  return item;
}

function selectOf(value, options) {
  const select = document.createElement("select");
  select.className = "wb-input";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  select.value = options.some((option) => option.value === value) ? value : "";
  return select;
}

function numberInputOf(value, min, max, step) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "wb-input";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function buildTypeField(box) {
  const input = textInputOf("", 40, "例: LP・料金ページ。自由な名前も書けます");
  input.id = "wb-type";
  input.setAttribute("list", "wb-type-options");
  input.addEventListener("change", () => {
    syncFamilyRow();
  });
  const list = document.createElement("datalist");
  list.id = "wb-type-options";
  box.append(fieldOf("画面の種類", input), list);
  state.form.type = input;
  state.form.datalist = list;
}

function renderTypeCandidates() {
  const list = state.form === null ? null : state.form.datalist;
  if (list === null) return;
  list.replaceChildren();
  for (const candidate of pageTypeCandidates()) {
    const option = document.createElement("option");
    option.value = text(record(candidate).name);
    list.append(option);
  }
}

// 自由な名前のときだけ出す「骨組み」の行 (7 種類から選び直せる)
function buildFamilyRow(box) {
  const row = el("div", "wb-row");
  row.hidden = true;
  const select = document.createElement("select");
  select.className = "wb-input";
  select.addEventListener("change", () => {
    if (select.value === "") return;
    state.pageType.family = select.value;
    schedulePreview();
  });
  row.append(el("span", "wb-caption", "骨組み"), select);
  box.append(row);
  state.familyRow = row;
  state.familySelect = select;
}

function renderFamilyOptions() {
  const select = state.familySelect;
  if (select === null) return;
  select.replaceChildren();
  // family が決まる前 (案を出す前) に選べないよう、空の値の案内を先頭に置く (選んでも何も起きない)
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "(案を出すと決まります)";
  select.append(placeholder);
  for (const candidate of pageTypeCandidates()) {
    const option = document.createElement("option");
    option.value = text(record(candidate).family);
    option.textContent = text(record(candidate).name);
    select.append(option);
  }
  select.value = state.pageType.family;
}

// 画面の種類の名前 (フォームの入力を正にする。空なら空文字にして、送る前に止める)
function pageTypeName() {
  const form = state.form;
  return form === null ? "" : form.type.value.trim();
}

// 画面の種類の名前に応じて、「骨組み」の行を出すか隠す (候補の名前なら server が family を決める)
function syncFamilyRow() {
  const row = state.familyRow;
  const select = state.familySelect;
  if (row === null || select === null) return;
  const name = pageTypeName();
  const matched = pageTypeCandidates().find((candidate) => record(candidate).name === name);
  state.pageType.name = name;
  if (matched !== undefined) state.pageType.family = text(record(matched).family);
  row.hidden = matched !== undefined;
  select.value = state.pageType.family;
}

function buildBriefFields(box) {
  const what = textareaOf("", 4, 2000);
  what.id = "wb-what";
  what.placeholder = "例: 落ち着いた雰囲気で、請求書を管理するアプリ";
  what.addEventListener("paste", onPaste);
  const mood = textInputOf("", 500);
  const audience = textInputOf("", 500);
  const mustHave = textInputOf("", 500);
  box.append(
    fieldOf("作りたいもの", what),
    fieldOf("雰囲気・キーワード", mood),
    fieldOf("使う人", audience),
    fieldOf("入れたい要素", mustHave),
  );
  state.form.what = what;
  state.form.mood = mood;
  state.form.audience = audience;
  state.form.mustHave = mustHave;
}

function buildBriefPanel(root) {
  const section = el("section", "wb-section");
  section.append(el("h3", null, "依頼"));
  section.append(el("p", "wb-note", "作りたいものを書いて「案を出す」を押すと、案 4 つが出ます。ほかの項目は任意です。"));
  const form = el("div", "wb-form");
  state.form = {
    type: null,
    what: null,
    mood: null,
    audience: null,
    mustHave: null,
    file: null,
    clear: null,
    preview: null,
    note: null,
    retry: null,
    button: null,
  };
  buildTypeField(form);
  buildFamilyRow(form);
  buildBriefFields(form);
  buildScreenshotRow(form);
  const button = el("button", "btn btn-primary", "案を出す");
  button.type = "button";
  button.addEventListener("click", () => {
    void generateFromForm();
  });
  state.form.button = button;
  const note = el("p", "wb-note");
  const retry = el("button", "btn", "もう一度");
  retry.type = "button";
  retry.hidden = true;
  retry.addEventListener("click", () => {
    void generateFromForm();
  });
  const row = el("div", "wb-row");
  row.append(note, retry, button);
  form.append(row);
  section.append(form);
  state.form.note = note;
  state.form.retry = retry;
  root.append(section);
}

function clearFormNote() {
  setNote(state.form?.note, "", false);
  if (state.form !== null) state.form.retry.hidden = true;
}

function collectBrief() {
  const form = state.form;
  if (form === null) return { what: "", mood: "", audience: "", mustHave: "" };
  return {
    what: form.what.value.trim(),
    mood: form.mood.value.trim(),
    audience: form.audience.value.trim(),
    mustHave: form.mustHave.value.trim(),
  };
}

// 一言から方向性の案を出す (POST /api/directions)。出し直し (回を足す) も同じ道を通る
async function generateFromForm() {
  if (state.generating || state.form === null) return;
  const brief = collectBrief();
  if (brief.what === "") {
    setNote(state.form.note, "作りたいものを書いてください", true);
    state.form.retry.hidden = true;
    state.form.what.focus();
    return;
  }
  if (pageTypeName() === "") {
    setNote(state.form.note, "画面の種類を書いてください", true);
    state.form.retry.hidden = true;
    state.form.type.focus();
    return;
  }
  state.generating = true;
  syncGenerateButtons(true);
  const session = nextSession();
  const stop = startElapsed(state.status, "案を考えています…");
  try {
    const body = { brief, pageType: { name: pageTypeName() } };
    if (state.screenshot !== null) body.screenshot = state.screenshot.dataUrl;
    const payload = await requestJson("/api/directions", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (state.session !== session) return; // あとから始めた作業がある → この応答は捨てる
    clearFormNote();
    acceptGeneration(payload);
    setStatus(`${String(state.rounds[state.roundIndex].drafts.length)} 案を出しました。プレビューを見比べてください。`, false);
  } catch (error) {
    if (state.session !== session) return;
    setStatus("案を出せませんでした。", true);
    setNote(state.form.note, `案を出せませんでした: ${errorMessage(error)}`, true);
    state.form.retry.hidden = false;
  } finally {
    stop();
    state.generating = false;
    syncGenerateButtons(false);
  }
}

function acceptGeneration(payload) {
  const directions = Array.isArray(record(payload).directions) ? record(payload).directions : [];
  if (directions.length === 0) throw new Error("方向性の案が返りませんでした");
  const family = text(record(payload).family);
  state.pageType = { name: pageTypeName(), family: family === "" ? state.pageType.family : family };
  state.projectId = null; // 新しく出した案は、次の保存で新しいプロジェクトになる
  if (projectPanel !== null) projectPanel.discardPages(); // 前のプロジェクトのページは開けなくなるので、一覧ごと捨てる
  syncFamilyRow();
  appendRound(directions);
}

function syncGenerateButtons(disabled) {
  if (state.form !== null) {
    state.form.button.disabled = disabled;
    state.form.retry.disabled = disabled;
  }
  if (state.printAgain !== null) state.printAgain.disabled = disabled || state.rounds.length === 0;
}

// ---------------------------------------------------------------- スクリーンショット

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(new Error("画像を読めませんでした"));
    });
    reader.readAsDataURL(file);
  });
}

async function takeScreenshot(file) {
  if (!SHOT_TYPES.includes(file.type)) {
    setStatus("参考画像は png か jpeg を選んでください。", true);
    if (state.form !== null) state.form.file.value = "";
    return;
  }
  if (file.size > SHOT_MAX_BYTES) {
    setStatus("参考画像は 5MB までです。", true);
    if (state.form !== null) state.form.file.value = "";
    return;
  }
  try {
    const dataUrl = await readDataUrl(file);
    const name = file.name === "" ? "貼り付けた画像" : file.name;
    state.screenshot = { name, dataUrl };
    syncScreenshot();
    setStatus(`参考画像を読み込みました: ${name}`, false);
  } catch (error) {
    setStatus(`参考画像を読み込めませんでした: ${errorMessage(error)}`, true);
  }
}

// 入力欄への貼り付け (png / jpeg のときだけ拾う)
function onPaste(event) {
  const transfer = event.clipboardData;
  if (transfer === null || transfer === undefined) return;
  const item = Array.from(transfer.items).find((entry) => entry.kind === "file" && SHOT_TYPES.includes(entry.type));
  if (item === undefined) return;
  const file = item.getAsFile();
  if (file === null) return;
  event.preventDefault();
  void takeScreenshot(file);
}

function syncScreenshot() {
  const form = state.form;
  if (form === null) return;
  const shot = state.screenshot;
  form.clear.hidden = shot === null;
  form.preview.hidden = shot === null;
  if (shot === null) {
    form.preview.removeAttribute("src");
    return;
  }
  form.preview.src = shot.dataUrl;
  form.preview.alt = `読み込んだ参考画像: ${shot.name}`;
}

function buildScreenshotRow(form) {
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg";
  file.addEventListener("change", () => {
    const chosen = file.files === null || file.files.length === 0 ? null : file.files[0];
    if (chosen !== null) void takeScreenshot(chosen);
  });
  const clear = el("button", "btn", "参考画像を外す");
  clear.type = "button";
  clear.hidden = true;
  clear.addEventListener("click", () => {
    state.screenshot = null;
    file.value = "";
    syncScreenshot();
  });
  const shot = document.createElement("img");
  shot.className = "wb-shot";
  shot.alt = "読み込んだ参考画像";
  shot.hidden = true;
  const row = el("div", "wb-row");
  row.append(fieldOf("スクリーンショット (任意)", file), clear);
  form.append(row, shot, el("p", "wb-note", "png か jpeg、5MB まで。「作りたいもの」の欄に画像を貼り付けても読み込めます。"));
  state.form.file = file;
  state.form.clear = clear;
  state.form.preview = shot;
}

// ---------------------------------------------------------------- 案と回

function buildRoundsPanel(root) {
  const section = el("section", "wb-section");
  section.append(el("h3", null, "案と回"));
  section.append(el("p", "wb-note", "案 A〜D のカード。編集すると「編集済み」の印が付き、「原案に戻す」で戻せます。"));
  const bar = el("div", "seg wb-round-bar");
  bar.hidden = true;
  section.append(bar);
  const printAgain = el("button", "btn", "案を出し直す");
  printAgain.type = "button";
  printAgain.disabled = true;
  printAgain.addEventListener("click", () => {
    void generateFromForm();
  });
  const row = el("div", "wb-row");
  row.append(printAgain);
  section.append(row);
  const cards = el("div", "wb-cards");
  section.append(cards);
  state.roundBar = bar;
  state.printAgain = printAgain;
  state.cards = cards;
  root.append(section);
  renderRoundBar();
  renderCards();
}

function renderRoundBar() {
  const bar = state.roundBar;
  if (bar !== null) {
    bar.replaceChildren();
    if (state.rounds.length > 1) {
      bar.hidden = false;
      state.rounds.forEach((_, index) => bar.append(roundButtonOf(index)));
    } else {
      bar.hidden = true;
    }
  }
  if (state.printAgain !== null) state.printAgain.disabled = state.rounds.length === 0;
}

function roundButtonOf(index) {
  const button = el("button", null, `回 ${String(index + 1)}`);
  button.type = "button";
  button.setAttribute("aria-pressed", String(index === state.roundIndex));
  button.addEventListener("click", () => {
    switchRound(index);
  });
  return button;
}

// 回を切り替える。編集中の案は閉じる
function switchRound(index) {
  if (index === state.roundIndex) return;
  state.roundIndex = index;
  state.editing = -1;
  renderRoundBar();
  renderCards();
  schedulePreview();
}

// 案の応答を新しい回にして足し、切り替える (前の回は残る)。パッドの点と微調整はいったん初期に戻す
function appendRound(drafts) {
  state.points = freshPoints();
  state.fineTune = {};
  state.editing = -1;
  state.rounds.push({ drafts, edits: drafts.map(() => null) });
  state.roundIndex = state.rounds.length - 1;
  previewSkeleton();
  renderRoundBar();
  renderCards();
  schedulePreview();
}

function renderCards() {
  if (panels !== null) panels.roundChanged();
  const box = state.cards;
  if (box === null) return;
  box.replaceChildren();
  const round = currentRound();
  if (round === null) {
    box.append(el("p", "wb-note", "「案を出す」を押すと、案 4 つがここに並びます。"));
    return;
  }
  round.drafts.forEach((_, index) => box.append(cardOf(round, index)));
}

function cardOf(round, index) {
  const edit = round.edits[index];
  const shown = editBaseOf(round, index);
  const card = el("article", "wb-card");
  const head = el("div", "wb-card-head");
  head.append(el("span", "wb-letter", LETTERS[index] ?? String(index + 1)));
  const name = text(shown.name);
  head.append(el("h4", null, name === "" ? "(名前なし)" : name));
  if (edit !== null && edit !== undefined) head.append(el("span", "wb-edited", "編集済み"));
  card.append(head, el("p", "wb-card-rationale", text(shown.rationale)));
  if (state.editing === index) {
    card.append(editorOf(round, index));
    return card;
  }
  card.append(cardToolsOf(round, index, edit));
  return card;
}

function cardToolsOf(round, index, edit) {
  const tools = el("div", "wb-row");
  const editButton = el("button", "btn", "編集");
  editButton.type = "button";
  editButton.addEventListener("click", () => {
    state.editing = index;
    renderCards();
  });
  tools.append(editButton);
  if (edit !== null && edit !== undefined) tools.append(revertButtonOf(index));
  return tools;
}

function revertButtonOf(index) {
  const button = el("button", "btn", "原案に戻す");
  button.type = "button";
  button.addEventListener("click", () => {
    revertDraft(index);
  });
  return button;
}

// 編集した案を AI の原案に戻す (edits を null に)
function revertDraft(index) {
  const round = currentRound();
  if (round === null) return;
  round.edits[index] = null;
  if (state.editing === index) state.editing = -1;
  renderCards();
  schedulePreview();
}

function abortEditing() {
  state.editing = -1;
  renderCards();
}

// ---------------------------------------------------------------- 案の編集

function editorOf(round, index) {
  // 編集ずみの案を開き直すときは、編集後の値で開く (原案は書き換えない)
  const base = editBaseOf(round, index);
  const fields = { items: [], layouts: {} };
  const form = el("div", "wb-editor");
  buildEditorIdentity(form, base, fields);
  buildEditorCopy(form, base, fields);
  buildEditorSeed(form, base, fields);
  buildEditorModes(form, base, fields);
  buildEditorLayouts(form, base, fields);
  const note = el("p", "wb-note status-editor");
  const save = el("button", "btn btn-primary", "保存");
  save.type = "button";
  save.addEventListener("click", () => {
    void saveEditor(round, index, fields, note, save);
  });
  const cancel = el("button", "btn", "やめる");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    abortEditing();
  });
  const tools = el("div", "wb-row");
  tools.append(save, cancel);
  form.append(tools, note);
  return form;
}

function buildEditorIdentity(form, base, fields) {
  const name = textInputOf(text(base.name), 80);
  name.required = true;
  fields.name = name;
  const rationale = textareaOf(text(base.rationale), 3, 500);
  fields.rationale = rationale;
  form.append(fieldOf("名前", name), fieldOf("狙い", rationale));
}

function buildEditorCopy(form, base, fields) {
  const group = el("div", "wb-group");
  group.append(el("span", "wb-caption", "文章"));
  const copy = record(base.copy);
  fields.headline = textInputOf(text(copy.headline), 200);
  fields.lead = textInputOf(text(copy.lead), 400);
  fields.cta = textInputOf(text(copy.cta), 100);
  group.append(fieldOf("見出し", fields.headline), fieldOf("リード", fields.lead), fieldOf("ボタン", fields.cta));
  const items = el("div", "wb-items");
  const add = el("button", "btn", "項目を足す");
  add.type = "button";
  add.addEventListener("click", () => {
    if (fields.items.length >= 6) return;
    fields.items.push(itemRowOf({ title: "", body: "" }, () => dropItem(fields, items, add)));
    refreshItems(items, fields, add);
  });
  for (const item of Array.isArray(copy.items) ? copy.items : []) {
    fields.items.push(itemRowOf(record(item), () => dropItem(fields, items, add)));
  }
  refreshItems(items, fields, add);
  group.append(el("span", "wb-caption", "項目 (3〜6 件、見出しと本文を書いてください)"), items, add);
  form.append(group);
}

function refreshItems(items, fields, add) {
  items.replaceChildren(...fields.items.map((row) => row.row));
  add.disabled = fields.items.length >= 6;
  for (const row of fields.items) row.remove.disabled = fields.items.length <= 3;
}

function dropItem(fields, items, add) {
  return (row) => {
    const at = fields.items.indexOf(row);
    if (at < 0) return;
    fields.items.splice(at, 1);
    refreshItems(items, fields, add);
  };
}

function itemRowOf(item, onDrop) {
  const row = el("div", "wb-item");
  const title = textInputOf(text(item.title), 200, "見出し");
  const body = textareaOf(text(item.body), 2, 600);
  const remove = el("button", "btn", "削除");
  remove.type = "button";
  remove.addEventListener("click", () => {
    onDrop(row);
  });
  row.append(fieldOf("見出し", title), fieldOf("本文", body), remove);
  return { row, title, body, remove };
}

function buildEditorSeed(form, base, fields) {
  const color = record(record(base.seed).color);
  const shape = record(record(base.seed).shape);
  fields.brandHue = numberInputOf(numberOf(color.brandHue, 210), 0, 359, 1);
  fields.brandChroma = numberInputOf(numberOf(color.brandChroma, 0.08), 0, 0.4, 0.01);
  fields.neutralHue = numberInputOf(numberOf(color.neutralHue, 210), 0, 359, 1);
  fields.neutralChroma = numberInputOf(numberOf(color.neutralChroma, 0.01), 0, 0.4, 0.01);
  fields.contrast = numberInputOf(numberOf(color.contrast, 1.2), 1, 5, 0.1);
  fields.radiusPx = numberInputOf(numberOf(shape.radiusPx, 8), 0, 32, 1);
  fields.spacingScale = numberInputOf(numberOf(shape.spacingScale, 1), 0.75, 1.5, 0.05);
  form.append(
    fieldOf("ブランドの色相", fields.brandHue),
    fieldOf("ブランドの彩度", fields.brandChroma),
    accentRowOf(color, fields),
    fieldOf("無彩色の色相", fields.neutralHue),
    fieldOf("無彩色の彩度", fields.neutralChroma),
    fieldOf("コントラスト", fields.contrast),
    fieldOf("角丸 (px)", fields.radiusPx),
    fieldOf("余白 (倍)", fields.spacingScale),
  );
}

// アクセントの色相。チェックで「なし」(null) にし、外すと前の値に戻る
function accentRowOf(color, fields) {
  const number = numberInputOf(typeof color.accentHue === "number" ? color.accentHue : numberOf(color.brandHue, 210), 0, 359, 1);
  const none = document.createElement("input");
  none.type = "checkbox";
  none.id = "wb-accent-none";
  none.checked = color.accentHue === null;
  number.disabled = none.checked;
  none.addEventListener("change", () => {
    number.disabled = none.checked;
  });
  const check = el("label", "wb-check", "なし");
  check.prepend(none);
  fields.accentHue = number;
  fields.accentNone = none;
  const row = el("div", "wb-field");
  row.append(el("span", "wb-caption", "アクセントの色相"), number, check);
  return row;
}

function fontOfPair(pair) {
  return {
    mood: text(pair.mood),
    heading: text(pair.heading),
    body: text(pair.body),
    mono: text(pair.mono),
    pairId: text(pair.id),
  };
}

function buildEditorModes(form, base, fields) {
  const seed = record(base.seed);
  // 影は種 (seed) の shape の中にある (core/types.ts)。直下には無い
  fields.shadow = selectOf(text(record(seed.shape).shadow), SHADOWS);
  fields.baseMode = selectOf(text(seed.baseMode), BASE_MODES);
  const grid = el("div", "wb-grid2");
  grid.append(fieldOf("影", fields.shadow), fieldOf("明るさ", fields.baseMode));
  form.append(grid);
  const pairRow = fontPairRowOf(seed, fields);
  if (pairRow !== null) form.append(pairRow);
}

// フォントの組。/api/meta に組が無いときは隠し、現在の pairId が組に無いときは「(そのまま)」を出す
function fontPairRowOf(seed, fields) {
  const pairs = fontPairs();
  if (pairs.length === 0) return null;
  const current = text(record(seed.font).pairId);
  const options = pairs.map((pair) => {
    const item = record(pair);
    return { value: text(item.id), label: `${text(item.heading)} / ${text(item.body)}` };
  });
  if (!options.some((option) => option.value === current)) options.unshift({ value: "", label: "(そのまま)" });
  fields.fontPair = selectOf(current, options);
  return fieldOf("フォントの組", fields.fontPair);
}

function buildEditorLayouts(form, base, fields) {
  const layouts = record(base.layouts);
  const grid = el("div", "wb-grid2");
  for (const family of SKELETON_FAMILIES) {
    const options = layoutsOf(family).map((layout) => ({ value: layout, label: layout }));
    const select = selectOf(text(layouts[family]), options);
    fields.layouts[family] = select;
    grid.append(fieldOf(familyLabel(family), select));
  }
  form.append(el("span", "wb-caption", "配置 (骨組みの種類ごとの型)"), grid);
}

// フォームの値を案の写しに上書きする (原案は書き換えない)
function applyEditorValues(base, fields) {
  const candidate = structuredClone(base);
  candidate.name = fields.name.value;
  candidate.rationale = fields.rationale.value;
  const copy = candidate.copy;
  copy.headline = fields.headline.value;
  copy.lead = fields.lead.value;
  copy.cta = fields.cta.value;
  copy.items = fields.items.map((item) => ({ title: item.title.value, body: item.body.value }));
  applySeedValues(candidate, fields);
  for (const family of SKELETON_FAMILIES) {
    const select = fields.layouts[family];
    if (select !== undefined) candidate.layouts[family] = select.value;
  }
  return candidate;
}

function applySeedValues(candidate, fields) {
  const color = candidate.seed.color;
  const shape = candidate.seed.shape;
  color.brandHue = numberValueOf(fields.brandHue);
  color.brandChroma = numberValueOf(fields.brandChroma);
  color.accentHue = fields.accentNone.checked ? null : numberValueOf(fields.accentHue);
  color.neutralHue = numberValueOf(fields.neutralHue);
  color.neutralChroma = numberValueOf(fields.neutralChroma);
  color.contrast = numberValueOf(fields.contrast);
  shape.radiusPx = numberValueOf(fields.radiusPx);
  shape.spacingScale = numberValueOf(fields.spacingScale);
  shape.shadow = fields.shadow.value;
  candidate.seed.baseMode = fields.baseMode.value;
  // フォントの組の選択は、/api/meta に組があるときだけ出す (無いときは現在の組をそのまま使う)
  if (fields.fontPair !== undefined && fields.fontPair.value !== "") {
    const pair = fontPairs()
      .map((item) => record(item))
      .find((item) => text(item.id) === fields.fontPair.value);
    if (pair !== undefined) candidate.seed.font = fontOfPair(pair);
  }
}

// 数値の入力をそのまま送る (範囲外や空はサーバーが止める。エラーは編集の下に出る)
const numberValueOf = (input) => {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : Number.NaN;
};

// 編集の保存。案 1 つを /api/mix に送って確かめ、通ったら編集後の案に入れる
async function saveEditor(round, index, fields, note, save) {
  if (currentRound() !== round || state.savingEdit) return;
  state.savingEdit = true;
  save.disabled = true;
  setNote(note, "確かめています…", false);
  let candidate = null;
  try {
    // 保存の元も編集後の案にする (開き直して保存しても前の編集を消さない)
    candidate = applyEditorValues(editBaseOf(round, index), fields);
    const body = { directions: [candidate], points: POINTS_A, fineTune: {} };
    await requestJson("/api/mix", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch (error) {
    setNote(note, `保存できませんでした: ${errorMessage(error)}`, true);
    save.disabled = false;
    state.savingEdit = false;
    return;
  }
  state.savingEdit = false;
  // 待っている間に編集が閉じられていたら、この結果は使わない
  if (state.editing !== index || currentRound() !== round) return;
  round.edits[index] = candidate;
  state.editing = -1;
  renderCards();
  schedulePreview();
}

// ---------------------------------------------------------------- プレビュー (中央)

function buildStagePanel(root) {
  const section = el("section", "wb-section");
  section.append(el("h3", null, "プレビュー"));
  const devices = el("div", "seg wb-devices");
  state.deviceSeg = devices;
  for (const device of DEVICES) devices.append(deviceButtonOf(device));
  const views = el("div", "seg wb-views");
  state.viewSeg = views;
  for (const view of PREVIEW_VIEWS) views.append(viewButtonOf(view));
  const rows = el("div", "wb-row");
  rows.append(devices, views);
  section.append(rows);
  state.stageNote = el("p", "wb-note", "案を出すと、混ぜた案の骨組みが出ます。");
  state.frameBox = el("div", "wb-frame");
  state.frameBox.hidden = true;
  state.frame = document.createElement("iframe");
  state.frame.title = "骨組みのプレビュー";
  state.frame.setAttribute("sandbox", "allow-scripts");
  state.frameBox.append(state.frame);
  section.append(state.stageNote, state.frameBox);
  frameObserver.observe(state.frameBox);
  root.append(section);
  syncPreviewView();
}

function deviceButtonOf(device) {
  const button = el("button", null, device.label);
  button.type = "button";
  button.dataset.device = device.key;
  button.setAttribute("aria-pressed", String(device.key === state.device));
  button.addEventListener("click", () => {
    if (state.device === device.key) return;
    state.device = device.key;
    syncDevices();
  });
  return button;
}

function syncDevices() {
  if (state.deviceSeg === null) return;
  for (const button of state.deviceSeg.querySelectorAll("button[data-device]")) {
    button.setAttribute("aria-pressed", String(button.dataset.device === state.device));
  }
  sizeFrame();
}

// 中央のプレビューの「骨組み / ページ」の切り替え
function viewButtonOf(view) {
  const button = el("button", null, view.label);
  button.type = "button";
  button.dataset.view = view.key;
  button.setAttribute("aria-pressed", String(view.key === state.previewMode));
  button.addEventListener("click", () => {
    switchPreviewView(view.key);
  });
  return button;
}

function syncPreviewView() {
  const seg = state.viewSeg;
  if (seg === null) return;
  for (const button of seg.querySelectorAll("button[data-view]")) {
    const key = button.dataset.view ?? "";
    button.setAttribute("aria-pressed", String(key === state.previewMode));
    if (key === "page") button.disabled = state.page === null;
  }
}

function switchPreviewView(key) {
  if (key === state.previewMode) return;
  if (key === "page" && state.page === null) return;
  state.previewMode = key;
  syncPreviewView();
  cancelScheduledPreview();
  if (key === "page") {
    drawPagePreview();
  } else {
    refreshPreview();
  }
}

// 新しい回に切り替えたら、中央のプレビューは骨組みに戻す
function previewSkeleton() {
  state.previewMode = "skeleton";
  syncPreviewView();
}

// 中央のプレビューをページに切り替える (null で骨組みに戻す)
function showPage(page) {
  state.page = page;
  state.previewMode = page === null ? "skeleton" : "page";
  syncPreviewView();
  cancelScheduledPreview();
  if (page === null) {
    refreshPreview();
    return;
  }
  drawPagePreview();
  // パッドや微調整に使う混ぜた値がまだ無ければ、裏で混ぜておく (プレビューはページのまま)
  if (state.tuned === null) schedulePreview();
}

function drawPagePreview() {
  const page = state.page;
  if (page === null) return;
  state.frameBox.hidden = false;
  state.frame.srcdoc = page.html;
  frameStatus(`いまのページ: ${text(record(page.pageType).name)}`, false);
  sizeFrame();
}

// 幅に合わせて縮めて見せる (枠の幅より端末の幅が大きければ零点の倍率、小さければ中央に置く)
function sizeFrame() {
  const box = state.frameBox;
  const frame = state.frame;
  const device = deviceOf(state.device);
  if (box === null || frame === null || box.hidden) return;
  frame.style.width = `${String(device.width)}px`;
  frame.style.height = `${String(FRAME_HEIGHT)}px`;
  const scale = Math.min(1, box.clientWidth / device.width);
  frame.style.transform = `scale(${String(scale)})`;
  frame.style.marginLeft = `${String(Math.max(0, Math.round((box.clientWidth - device.width * scale) / 2)))}px`;
  box.style.height = `${String(Math.round(FRAME_HEIGHT * scale) + 2)}px`;
}

function frameStatus(message, isError) {
  setNote(state.stageNote, message, isError);
}

function schedulePreview() {
  if (state.timer !== 0) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = 0;
    void refreshPreview();
  }, SEND_DELAY_MS);
}

// 予約ずみの描き直しを取り消す (ページに切り替えるときなど、すぐ描くとき)
function cancelScheduledPreview() {
  if (state.timer === 0) return;
  clearTimeout(state.timer);
  state.timer = 0;
}

// プレビューを描き直す。世代を進め、途中の古い応答は捨てる。
// ページを出しているときは、枠の中身は変えず、右の列の値 (混ぜた結果と判定) だけ新しくする
function refreshPreview() {
  const round = currentRound();
  if (round === null) return;
  state.previewToken += 1;
  const show = !(state.previewMode === "page" && state.page !== null);
  void mixRound(round, state.previewToken, show);
}

async function mixRound(round, token, show) {
  if (show) frameStatus("骨組みを描いています…", false);
  let payload = null;
  try {
    const body = { directions: effectiveDirections(round), points: state.points, fineTune: state.fineTune };
    payload = await requestJson("/api/mix", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  } catch (error) {
    if (state.previewToken !== token) return;
    if (show) frameStatus(`混ぜられませんでした: ${errorMessage(error)}`, true);
    return;
  }
  if (state.previewToken !== token) return;
  state.mixed = record(record(payload).mixed); // 混ぜただけ (微調整の初期値)
  state.tuned = record(record(payload).direction); // 微調整込み (トークンとページに使う)
  if (panels !== null) panels.onMixed(record(payload).snapped);
  await drawFrame(state.tuned, token, show);
}

async function drawFrame(direction, token, show) {
  const payload = await requestRender(direction, token, show);
  if (payload === null) return;
  if (panels !== null) panels.onRender(payload); // コントラストの判定
  if (!show) return;
  // 待っている間にページへ切り替わっていたら、骨組みでページを上書きしない
  if (state.previewMode === "page" && state.page !== null) return;
  paintFrame(payload, direction);
}

// /api/render を呼ぶ。失敗したら (骨組みを出しているときだけ) 枠の状態に出し、null を返す
async function requestRender(direction, token, show) {
  if (state.pageType.family === "") {
    if (show) frameStatus("骨組みの種類が決まっていません。画面の種類を選び直してください。", true);
    return null;
  }
  try {
    const body = { direction, family: state.pageType.family };
    const payload = await requestJson("/api/render", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    return state.previewToken === token ? record(payload) : null;
  } catch (error) {
    if (state.previewToken !== token) return null;
    if (show) frameStatus(`骨組みを描けませんでした: ${errorMessage(error)}`, true);
    return null;
  }
}

// 骨組みの HTML を中央の枠に出す
function paintFrame(payload, direction) {
  const html = text(payload.html);
  if (html === "") {
    frameStatus("骨組みが返りませんでした。案を出し直してください。", true);
    return;
  }
  state.frameBox.hidden = false;
  state.frame.srcdoc = html;
  frameStatus(`いまの混ぜ方の案: ${text(direction.name)}`, false);
  sizeFrame();
}

// ---------------------------------------------------------------- 右の列 (パッド・微調整・コントラスト・トークン、ページ・保存)

// 右の列の 2 つのモジュール (ui-workbench-panels.js・ui-workbench-project.js) に渡す道具立て
function panelContext() {
  return {
    state,
    el,
    text,
    record,
    numberOf,
    errorMessage,
    requestJson,
    requestText,
    setNote,
    setStatus,
    startElapsed,
    JSON_HEADERS,
    nextSession,
    schedulePreview,
    currentRound,
    effectiveDirections,
    collectBrief,
    pageTypeName,
    fontPairs,
    layoutsOf,
    showPage,
    applyProject,
  };
}

function buildSidePanels(root) {
  const context = panelContext();
  panels = createPanels(context);
  panels.build(root);
  projectPanel = createProjectPanel(context);
  projectPanel.build(root);
}

// ---------------------------------------------------------------- 保存したプロジェクトを戻す

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function pointOf(value) {
  const point = record(value);
  return { x: clamp01(numberOf(point.x, 0)), y: clamp01(numberOf(point.y, 0)) };
}

function pointsOf(value) {
  const points = record(value);
  return { color: pointOf(points.color), font: pointOf(points.font), shape: pointOf(points.shape), layout: pointOf(points.layout) };
}

function roundsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const round = record(entry);
    return { drafts: Array.isArray(round.drafts) ? round.drafts : [], edits: Array.isArray(round.edits) ? round.edits : [] };
  });
}

function pageEntriesOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const page = record(entry);
    return { name: text(page.name), family: text(page.family), key: text(page.key), html: null };
  });
}

// 保存したプロジェクトの依頼・回・点・微調整・ページの一覧を画面に戻す
function applyProject(raw) {
  const project = record(raw);
  const pageType = record(project.pageType);
  const form = state.form;
  if (form !== null) {
    const brief = record(project.brief);
    form.what.value = text(brief.what);
    form.mood.value = text(brief.mood);
    form.audience.value = text(brief.audience);
    form.mustHave.value = text(brief.mustHave);
    form.type.value = text(pageType.name);
  }
  state.pageType = { name: text(pageType.name), family: text(pageType.family) };
  state.rounds = roundsOf(project.rounds);
  state.roundIndex = Math.min(Math.max(0, Math.round(numberOf(project.roundIndex, 0))), Math.max(0, state.rounds.length - 1));
  state.editing = -1;
  state.points = pointsOf(project.points);
  state.fineTune = structuredClone(record(project.fineTune));
  state.pageList = pageEntriesOf(project.pages);
  state.page = null;
  state.projectId = text(project.id);
  state.mixed = null;
  state.tuned = null;
  previewSkeleton();
  syncFamilyRow();
  renderRoundBar();
  renderCards();
  if (panels !== null) {
    panels.setPoints(state.points);
    panels.setFineTune(state.fineTune);
  }
  schedulePreview();
  clearFormNote();
}

// ---------------------------------------------------------------- 見本帳から始める

async function startFromStyle(styleId, family) {
  if (styleId === "") return;
  const session = nextSession();
  setStatus(`スタイル「${styleId}」を読み込んでいます…`, false);
  let payload = null;
  try {
    payload = await requestJson("/api/styles");
  } catch (error) {
    if (state.session !== session) return;
    setStatus(`スタイルを読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  if (state.session !== session) return;
  const styles = Array.isArray(record(payload).styles) ? record(payload).styles : [];
  const style = styles.map((item) => record(item)).find((item) => text(item.id) === styleId);
  if (style === undefined) {
    setStatus(`スタイル「${styleId}」が見つかりませんでした。`, true);
    return;
  }
  beginFromStyle(style, family);
}

// スタイル 1 つを原案にして回を作る。フォームに入力があれば残し、無ければ埋める
function beginFromStyle(style, family) {
  const form = state.form;
  const typedName = form === null ? "" : familyLabel(family);
  if (form !== null) {
    if (form.what.value.trim() === "") form.what.value = text(style.name);
    if (form.type.value.trim() === "") form.type.value = typedName;
  }
  state.pageType = { name: pageTypeName(), family };
  clearFormNote();
  state.points = freshPoints();
  state.fineTune = {};
  state.editing = -1;
  state.rounds = [{ drafts: [style], edits: [null] }];
  state.roundIndex = 0;
  previewSkeleton();
  renderRoundBar();
  renderCards();
  syncFamilyRow();
  schedulePreview();
  setStatus(`スタイル「${text(style.name)}」から始めます。案を 1 つにして、編集や微調整ができます。`, false);
}

// ---------------------------------------------------------------- /api/meta と起動

async function loadMeta() {
  let payload = null;
  try {
    payload = await requestJson("/api/meta");
  } catch (error) {
    setStatus(`画面の種類の候補を読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  state.meta = record(payload);
  renderTypeCandidates();
  renderFamilyOptions();
  syncFamilyRow();
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = WORKBENCH_CSS;
  document.head.append(style);
}

function load() {
  const root = document.getElementById("workbench");
  if (root === null) return;
  injectStyles();
  const waiting = root.querySelector(".wb-waiting");
  if (waiting !== null) waiting.hidden = true;
  state.status = document.getElementById("wb-status");
  if (state.status === null) {
    state.status = el("p", "status");
    root.append(state.status);
  }
  state.columns = {
    brief: document.getElementById("wb-brief"),
    stage: document.getElementById("wb-stage"),
    panels: document.getElementById("wb-panels"),
  };
  if (state.columns.brief === null || state.columns.stage === null || state.columns.panels === null) return;
  buildBriefPanel(state.columns.brief);
  buildRoundsPanel(state.columns.brief);
  buildStagePanel(state.columns.stage);
  buildSidePanels(state.columns.panels);
  void loadMeta();
}

window.addEventListener("studio:start-from-style", (event) => {
  if (state.form === null) return; // 作業台を組み立てていないときは何もしない
  const detail = event instanceof CustomEvent ? record(event.detail) : {};
  switchToWorkbench();
  void startFromStyle(text(detail.styleId), text(detail.pageType));
});

void load();
