// 作業台の画面。曖昧な一言から方向性の案を 3 つ出して骨組みで見比べ、選ぶか 4 つの軸で混ぜ、
// 色相・角丸・余白を微調整して、LLM にページを作らせて保存する。
// 見本帳の「これに近いもので作る」から studio:start-from-style を受けたら、そのスタイル 1 つから始める。
// API: POST /api/directions /api/mix /api/render /api/page /api/projects、GET /api/styles /api/projects
const PAGE_TYPES = [
  { key: "lp", label: "LP" },
  { key: "dashboard", label: "ダッシュボード" },
  { key: "blog", label: "ブログ記事" },
];

const AXES = [
  { key: "color", label: "色", hint: "ブランド色とアクセント色" },
  { key: "font", label: "フォント", hint: "見出しと本文の書体" },
  { key: "shape", label: "形", hint: "角丸・影・余白の感じ" },
  { key: "layout", label: "配置", hint: "画面の組み立て方" },
];

const LETTERS = ["A", "B", "C"];
// プレビューは 1280×800 で描き、置き場の幅に合わせて縮める
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 800;
const SHOT_MAX_BYTES = 5 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg"];
const ADJUST_DELAY_MS = 300;
const JSON_HEADERS = { "Content-Type": "application/json" };
// 作業台だけの CSS。共通の CSS は殻 (app/index.html) にあり、そちらは触れないため、ここで足す
const WORKBENCH_CSS = `
.wb-panel { margin: 0 0 18px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow); }
.wb-panel h3 { margin: 0 0 6px; font-size: 16px; }
.wb-panel h4 { margin: 12px 0 4px; font-size: 14px; }
.wb-note { margin: 6px 0; font-size: 13px; color: var(--muted); }
.wb-form { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wb-form textarea { width: 100%; min-height: 70px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; resize: vertical; }
.wb-select { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); }
.wb-row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.wb-panel [hidden] { display: none; }
.wb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.wb-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.wb-card h4 { margin: 0; font-size: 15px; }
.wb-card p { margin: 0; font-size: 13px; color: var(--muted); }
.wb-frame { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.wb-frame iframe { display: block; width: 1280px; height: 800px; border: 0; transform-origin: top left; pointer-events: none; }
.wb-picks { display: flex; flex-wrap: wrap; gap: 6px; }
.wb-pick { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-pick[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.wb-axis { margin: 0 0 10px; }
.wb-axis-label { margin: 0 0 4px; font-size: 13.5px; font-weight: 600; }
.wb-axis-hint { margin-left: 8px; color: var(--muted); font-weight: 400; }
.wb-sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 16px; margin-bottom: 10px; }
.wb-slider { display: flex; flex-direction: column; gap: 2px; }
.wb-slider-head { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
.wb-slider input { width: 100%; }
.wb-slider-value { color: var(--muted); font-variant-numeric: tabular-nums; }
.wb-shot { max-width: 180px; max-height: 100px; border: 1px solid var(--line); border-radius: 6px; }
.wb-projects { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wb-project { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; justify-content: space-between; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
.wb-project p { margin: 0; font-size: 13px; }
`;

// 画面の状態。描画はすべてここから行う
const state = {
  status: null, // 画面上部の状態
  ui: null, // 1. 入力の要素
  panels: {}, // 手順ごとの section
  tune: null, // 4. 調整の要素と大きめのプレビュー
  pageUi: null, // 5. ページの要素
  saveUi: null, // 6. 保存の要素
  projectsList: null, // 保存済みの一覧の置き場
  directionsBox: null, // 案のカードの置き場
  axesBox: null, // 軸ごとの選択の置き場
  pageTypeSelects: [], // 画面の種類の select (入力とページで共有)
  directionPreviews: [], // 案のカードのプレビュー (画面の種類を変えたら描き直す)
  directions: [], // 案 (1〜3 件)
  picks: { color: 0, font: 0, shape: 0, layout: 0 },
  current: null, // いまの方向性 (調整の対象)
  mode: "light", // プレビューの表示
  prompt: "",
  pageType: "lp",
  screenshot: null, // { name, dataUrl }
  page: null, // 作ったページ { html, pageType, openUrl, downloadUrl }
  projectId: null, // 保存の id
  busy: false,
  session: 0, // 作業の世代 (新しい作業を始めるたびに進み、古い応答を捨てる)
  token: 0, // 大きめのプレビューの世代 (古い応答を捨てる)
  applyToken: 0, // 選び直しの世代 (追い越された混ぜるの応答を捨てる)
  timer: 0, // 調整の連打をまとめるタイマー
  frames: new Set(), // 幅に合わせて縮めるプレビュー
};

const observer = new ResizeObserver(() => {
  for (const entry of state.frames) fitFrame(entry);
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round(value * 100) / 100;

// いまの作業の世代。新しい作業 (案を出す・開き直す・ページを作る・見本帳から始める) を始めるたびに 1 進める。
// await のあとで食い違っていれば、あとから始めた作業があるため、その応答は捨てる
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
    throw new Error(message === "" ? `HTTP ${res.status}` : message);
  }
  return body;
}

async function requestText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return await res.text();
}

function pageLabel(pageType) {
  const found = PAGE_TYPES.find((page) => page.key === pageType);
  return found === undefined ? pageType : found.label;
}

function pageTypeOf(value) {
  const found = PAGE_TYPES.find((page) => page.key === value);
  return found === undefined ? "lp" : found.key;
}

function baseModeOf(direction) {
  const seed = record(record(direction).seed);
  return seed.baseMode === "dark" ? "dark" : "light";
}

const directionName = (direction) => text(record(direction).name);

// 1280×800 の iframe を、置き場の幅に合わせて縮める (高さも合わせる。枠の 2px は足しておく)
function fitFrame(entry) {
  const width = entry.box.clientWidth;
  if (width <= 0) return;
  const scale = width / FRAME_WIDTH;
  entry.frame.style.transform = `scale(${String(scale)})`;
  entry.box.style.height = `${String(Math.round(FRAME_HEIGHT * scale) + 2)}px`;
}

function registerFrame(entry) {
  state.frames.add(entry);
  observer.observe(entry.box);
}

// 骨組み・ページを入れるプレビュー。sandbox で親の文書と切り離す (Tailwind を動かすので allow-scripts は要る)
function createPreview(title) {
  const wrap = el("div", "wb-preview");
  const box = el("div", "wb-frame");
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("sandbox", "allow-scripts");
  const error = el("p", "wb-note");
  error.hidden = true;
  box.append(frame);
  wrap.append(box, error);
  const entry = { wrap, box, frame, error, token: 0 };
  registerFrame(entry);
  return entry;
}

function setFrameHtml(entry, html) {
  entry.error.hidden = true;
  entry.error.classList.remove("status-error");
  entry.frame.srcdoc = html;
  fitFrame(entry);
}

function showFrameError(entry, message) {
  entry.error.textContent = message;
  entry.error.classList.add("status-error");
  entry.error.hidden = false;
}

// 骨組みを描いて iframe に入れる。追い越された古い応答は捨てる。描けなければ null
async function renderInto(entry, direction, mode) {
  entry.token += 1;
  const token = entry.token;
  const body = { direction, pageType: state.pageType };
  if (mode !== undefined) body.mode = mode;
  try {
    const payload = await requestJson("/api/render", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (entry.token !== token) return null;
    setFrameHtml(entry, text(record(payload).html));
    return record(payload);
  } catch (error) {
    if (entry.token !== token) return null;
    showFrameError(entry, `骨組みを描けませんでした: ${errorMessage(error)}`);
    return null;
  }
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

// いまの一言 (入力欄を正にする)。保存とページ作成が使う
function currentPrompt() {
  const ui = state.ui;
  if (ui !== null) state.prompt = ui.prompt.value.trim();
  return state.prompt;
}

// 一言から id の前半 (英小文字とハイフン) を作る
function slugOf(prompt) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") return "project";
  return slug.slice(0, 24).replace(/-+$/g, "");
}

// id は一言の英小文字とハイフン + 日時 (/^[a-z0-9][a-z0-9-]{0,39}$/ に収める)
function makeProjectId(prompt) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${slugOf(prompt)}-${stamp}`;
}

function pageTypeSelect() {
  const select = document.createElement("select");
  select.className = "wb-select";
  for (const page of PAGE_TYPES) {
    const option = document.createElement("option");
    option.value = page.key;
    option.textContent = page.label;
    select.append(option);
  }
  select.value = state.pageType;
  select.addEventListener("change", () => {
    setPageType(select.value);
  });
  state.pageTypeSelects.push(select);
  return select;
}

// 画面の種類を変える。案と大きめのプレビューは、新しい種類で描き直す
function setPageType(value) {
  const pageType = pageTypeOf(value);
  if (pageType === state.pageType) return;
  state.pageType = pageType;
  for (const select of state.pageTypeSelects) select.value = pageType;
  if (state.directions.length > 0) renderAllPreviews();
}

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

// 参考画像を data URL にして持ち、プレビューと「外す」を出す
async function takeScreenshot(file) {
  if (!SHOT_TYPES.includes(file.type)) {
    setStatus("参考画像は png か jpeg を選んでください。", true);
    if (state.ui !== null) state.ui.file.value = "";
    return;
  }
  if (file.size > SHOT_MAX_BYTES) {
    setStatus("参考画像は 5MB までです。", true);
    if (state.ui !== null) state.ui.file.value = "";
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
function onPromptPaste(event) {
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
  const ui = state.ui;
  if (ui === null) return;
  const shot = state.screenshot;
  ui.clear.hidden = shot === null;
  ui.preview.hidden = shot === null;
  if (shot === null) {
    ui.preview.removeAttribute("src");
    return;
  }
  ui.preview.src = shot.dataUrl;
  ui.preview.alt = `読み込んだ参考画像: ${shot.name}`;
}

function buildInputPanel() {
  const box = el("section", "wb-panel");
  box.append(el("h3", null, "1. 作りたいもの"));
  box.append(
    el("p", "wb-note", "どんなページを作りたいかを一言で書いてください。画面の種類と、参考のスクリーンショット (任意) も指定できます。"),
  );

  const select = pageTypeSelect();
  const typeField = el("label", "field");
  typeField.append(el("span", null, "画面の種類"), select);

  const promptLabel = el("label", "wb-axis-label", "一言 (作りたいもの)");
  promptLabel.htmlFor = "wb-prompt";
  const prompt = document.createElement("textarea");
  prompt.id = "wb-prompt";
  prompt.rows = 3;
  prompt.maxLength = 2000;
  prompt.placeholder = "例: 落ち着いた雰囲気で、請求書を管理するアプリ";
  prompt.addEventListener("paste", onPromptPaste);

  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg";
  file.addEventListener("change", () => {
    const chosen = file.files === null || file.files.length === 0 ? null : file.files[0];
    if (chosen !== null) void takeScreenshot(chosen);
  });
  const fileField = el("label", "field");
  fileField.append(el("span", null, "参考のスクリーンショット (任意)"), file);
  const clear = el("button", "btn", "参考画像を外す");
  clear.type = "button";
  clear.hidden = true;
  clear.addEventListener("click", () => {
    state.screenshot = null;
    file.value = "";
    syncScreenshot();
  });
  const shotRow = el("div", "wb-row");
  shotRow.append(fileField, clear);

  const preview = document.createElement("img");
  preview.className = "wb-shot";
  preview.alt = "読み込んだ参考画像";
  preview.hidden = true;

  const button = el("button", "btn btn-primary", "案を出す");
  button.type = "button";
  button.addEventListener("click", () => {
    void generateDirections();
  });

  box.append(
    typeField,
    promptLabel,
    prompt,
    shotRow,
    el("p", "wb-note", "png か jpeg、5MB まで。入力欄に画像を貼り付けても読み込めます。"),
    preview,
    button,
  );
  state.ui = { prompt, file, clear, preview, button };
  return box;
}

// 一言から方向性の案を出す (POST /api/directions)
async function generateDirections() {
  if (state.busy || state.ui === null) return;
  const ui = state.ui;
  const prompt = ui.prompt.value.trim();
  if (prompt === "") {
    setStatus("作りたいものを一言で入力してください。", true);
    ui.prompt.focus();
    return;
  }
  const body = { prompt, pageType: state.pageType };
  if (state.screenshot !== null) body.screenshot = state.screenshot.dataUrl;
  const session = nextSession();
  state.busy = true;
  ui.button.disabled = true;
  const stop = startElapsed(state.status, "方向性の案を考えています…");
  try {
    const payload = await requestJson("/api/directions", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (state.session !== session) return; // あとから始めた作業がある → この応答は捨てる (進行の表示と busy は finally で戻す)
    const list = Array.isArray(record(payload).directions) ? record(payload).directions : [];
    if (list.length === 0) throw new Error("方向性の案が返りませんでした");
    state.prompt = prompt;
    state.projectId = null;
    beginDirections(list);
    setStatus(`${String(list.length)} つの案を出しました。骨組みを見比べてください。`, false);
  } catch (error) {
    if (state.session !== session) return;
    setStatus(`案を出せませんでした: ${errorMessage(error)}。一言を書き換えて、もう一度「案を出す」を押してください。`, true);
  } finally {
    stop();
    state.busy = false;
    ui.button.disabled = false;
  }
}

function buildDirectionsPanel() {
  const box = el("section", "wb-panel");
  box.hidden = true;
  box.append(el("h3", null, "2. 方向性の案"));
  box.append(el("p", "wb-note", "案を骨組みで見比べられます。気に入らなければ、一言を書き換えて「案を出す」を押すと作り直せます。"));
  const cards = el("div", "wb-grid");
  box.append(cards);
  state.directionsBox = cards;
  return box;
}

function buildAxesPanel() {
  const box = el("section", "wb-panel");
  box.hidden = true;
  box.append(el("h3", null, "3. 選ぶ・混ぜる"));
  box.append(
    el(
      "p",
      "wb-note",
      "軸ごとに、どの案のものを使うかを選べます (既定はすべて A)。選ぶと「4. 細かく調整する」のプレビューが描き直されます。",
    ),
  );
  const rows = el("div");
  box.append(rows);
  state.axesBox = rows;
  return box;
}

function createSlider(caption, min, max, step) {
  const field = el("label", "wb-slider");
  const head = el("span", "wb-slider-head");
  const value = el("span", "wb-slider-value");
  head.append(el("span", "wb-axis-label", caption), value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener("input", () => {
    onAdjust();
  });
  field.append(head, input);
  return { field, input, value };
}

function modeButton(label, mode) {
  const button = el("button", "btn", label);
  button.type = "button";
  button.dataset.mode = mode;
  button.addEventListener("click", () => {
    setMode(mode);
  });
  return button;
}

function buildTunePanel() {
  const box = el("section", "wb-panel");
  box.hidden = true;
  box.append(el("h3", null, "4. 細かく調整する"));
  box.append(el("p", "wb-note", "スライダーを動かすと、その場で骨組みを描き直します。"));
  const name = el("p", "wb-note");
  const sliders = el("div", "wb-sliders");
  const hue = createSlider("ブランドの色相", 0, 359, 1);
  const radius = createSlider("角丸 (px)", 0, 32, 1);
  const spacing = createSlider("余白 (倍)", 0.75, 1.5, 0.05);
  sliders.append(hue.field, radius.field, spacing.field);
  const seg = el("div", "seg");
  const light = modeButton("ライト", "light");
  const dark = modeButton("ダーク", "dark");
  seg.append(light, dark);
  const modeRow = el("div", "wb-row");
  modeRow.append(el("span", "wb-axis-label", "表示"), seg);
  const note = el("p", "status");
  const preview = createPreview("いまの方向性の骨組み");
  box.append(name, sliders, modeRow, note, preview.wrap);
  state.tune = { name, hue, radius, spacing, light, dark, note, preview };
  return box;
}

function buildPagePanel() {
  const box = el("section", "wb-panel");
  box.hidden = true;
  box.append(el("h3", null, "5. ページを作る"));
  box.append(
    el(
      "p",
      "wb-note",
      "決めた方向性で、1 ファイルの HTML ページを LLM に作らせます。数分かかることがあります。画面の種類を変えて、同じ方向性の別のページも作れます。",
    ),
  );
  const typeField = el("label", "field");
  typeField.append(el("span", null, "作るページの種類"), pageTypeSelect());
  const button = el("button", "btn btn-primary", "このページを作る");
  button.type = "button";
  button.addEventListener("click", () => {
    void createPage();
  });
  const progress = el("span", "status");
  const row = el("div", "wb-row");
  row.append(typeField, button, progress);
  const actions = el("div", "wb-row");
  actions.hidden = true;
  const open = el("button", "btn", "別タブで開く");
  open.type = "button";
  open.addEventListener("click", () => {
    openPage();
  });
  const download = el("button", "btn", "HTML をダウンロード");
  download.type = "button";
  download.addEventListener("click", () => {
    downloadPage();
  });
  actions.append(open, download);
  const note = el("p", "wb-note");
  const preview = createPreview("作ったページ");
  preview.wrap.hidden = true;
  box.append(row, actions, note, preview.wrap);
  state.pageUi = { button, progress, actions, note, preview };
  return box;
}

function buildSavePanel() {
  const box = el("section", "wb-panel");
  box.append(el("h3", null, "6. 保存する"));
  box.append(el("p", "wb-note", "保存すると、一言・方向性・ページをあとから開き直せます。"));
  const button = el("button", "btn", "保存");
  button.type = "button";
  button.addEventListener("click", () => {
    void saveProject();
  });
  const row = el("div", "wb-row");
  row.append(button);
  const note = el("p", "status");
  const list = el("ul", "wb-projects");
  box.append(row, note, el("h4", null, "保存済みのプロジェクト"), list);
  state.projectsList = list;
  state.saveUi = { button, note };
  return box;
}

// 案 (1〜3 件) から、選ぶ・調整する・ページを作るの各手順を組み立てる
function beginDirections(directions) {
  nextSession(); // ここから先が新しい作業。これより前の応答は使わない
  clearDirectionPreviews();
  state.applyToken += 1; // 途中の「混ぜる」があっても、古い結果は使わない
  state.directions = directions;
  state.picks = { color: 0, font: 0, shape: 0, layout: 0 };
  const first = directions[0];
  state.current = first === undefined ? null : structuredClone(first);
  state.mode = baseModeOf(state.current);
  setPage(null);
  showDirections();
  renderAxes();
  syncAxisButtons();
  syncTune();
  state.panels.directions.hidden = false;
  state.panels.axes.hidden = false;
  state.panels.tune.hidden = false;
  state.panels.page.hidden = false;
  renderAllPreviews();
}

function clearDirectionPreviews() {
  for (const item of state.directionPreviews) {
    observer.unobserve(item.entry.box);
    state.frames.delete(item.entry);
  }
  state.directionPreviews = [];
}

function directionCard(direction, index) {
  const card = el("article", "wb-card");
  card.append(el("h4", null, directionName(direction)));
  card.append(el("p", null, text(record(direction).rationale)));
  const preview = createPreview(`${directionName(direction)} の骨組み`);
  card.append(preview.wrap);
  state.directionPreviews.push({ entry: preview, direction });
  if (state.directions.length > 1) {
    const decide = el("button", "btn", "この案で決める");
    decide.type = "button";
    decide.addEventListener("click", () => {
      decideOn(index);
    });
    card.append(decide);
  }
  return card;
}

function showDirections() {
  const box = state.directionsBox;
  if (box === null) return;
  box.replaceChildren();
  state.directions.forEach((direction, index) => box.append(directionCard(direction, index)));
}

function axisRow(axis) {
  const row = el("div", "wb-axis");
  const label = el("p", "wb-axis-label");
  label.append(el("span", null, axis.label), el("span", "wb-axis-hint", axis.hint));
  const picks = el("div", "wb-picks");
  state.directions.forEach((direction, index) => {
    const button = el("button", "btn wb-pick", `${LETTERS[index] ?? String(index + 1)}: ${directionName(direction)}`);
    button.type = "button";
    button.dataset.axis = axis.key;
    button.dataset.index = String(index);
    button.addEventListener("click", () => {
      state.picks[axis.key] = index;
      void applyPicks();
    });
    picks.append(button);
  });
  row.append(label, picks);
  return row;
}

function renderAxes() {
  const box = state.axesBox;
  if (box === null) return;
  box.replaceChildren();
  if (state.directions.length < 2) {
    box.append(el("p", "wb-note", "案が 1 つなので、そのまま「4. 細かく調整する」に進めます。"));
    return;
  }
  for (const axis of AXES) box.append(axisRow(axis));
}

// いまの picks をボタンの押下の見た目に写す
function syncAxisButtons() {
  const box = state.axesBox;
  if (box === null) return;
  for (const button of box.querySelectorAll("button[data-axis]")) {
    const axis = button.dataset.axis ?? "";
    const index = Number(button.dataset.index);
    button.setAttribute("aria-pressed", String(state.picks[axis] === index));
  }
}

// 4 軸が同じ案なら混ぜる必要がないので、その案をそのまま使う (スタイルから始めたときも id と名前が残る)
async function applyPicks() {
  if (state.directions.length === 0) return;
  state.applyToken += 1;
  const token = state.applyToken;
  syncAxisButtons();
  if (AXES.every((axis) => state.picks[axis.key] === state.picks.color)) {
    const chosen = state.directions[state.picks.color];
    if (chosen !== undefined) adoptDirection(structuredClone(chosen));
    setStatus("", false);
    return;
  }
  setStatus("選んだ組み合わせを混ぜています…", false);
  try {
    const payload = await requestJson("/api/mix", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ directions: state.directions, picks: state.picks }),
    });
    if (state.applyToken !== token) return;
    const mixed = record(payload).direction;
    adoptDirection(mixed);
    setStatus(`混ぜました: ${directionName(mixed)}`, false);
  } catch (error) {
    if (state.applyToken !== token) return;
    setStatus(`混ぜられませんでした: ${errorMessage(error)}`, true);
  }
}

function decideOn(index) {
  for (const axis of AXES) state.picks[axis.key] = index;
  void applyPicks();
}

// いまの方向性を差し替えて、調整の値を読み直し、大きめのプレビューを描き直す
function adoptDirection(direction) {
  state.current = direction;
  state.mode = baseModeOf(direction);
  syncTune();
  void renderCurrent();
}

// いまの方向性の値を、スライダーと押下の見た目に写す
function syncTune() {
  const tune = state.tune;
  if (tune === null) return;
  tune.light.setAttribute("aria-pressed", String(state.mode === "light"));
  tune.dark.setAttribute("aria-pressed", String(state.mode === "dark"));
  const current = state.current;
  if (current === null) return;
  tune.name.textContent = `いまの方向性: ${directionName(current)}`;
  const { color, shape } = current.seed;
  tune.hue.input.value = String(color.brandHue);
  tune.radius.input.value = String(shape.radiusPx);
  tune.spacing.input.value = String(shape.spacingScale);
  showTune(color.brandHue, shape.radiusPx, shape.spacingScale);
}

function showTune(hue, radius, spacing) {
  const tune = state.tune;
  if (tune === null) return;
  tune.hue.value.textContent = String(Math.round(hue));
  tune.radius.value.textContent = `${String(Math.round(radius))}px`;
  tune.spacing.value.textContent = String(round2(spacing));
}

// スライダーの値を direction.seed に写して、描き直しを予約する (連打は 300ms にまとめる)
function onAdjust() {
  const tune = state.tune;
  const current = state.current;
  if (tune === null || current === null) return;
  const hue = clamp(Number(tune.hue.input.value), 0, 359);
  const radius = clamp(Number(tune.radius.input.value), 0, 32);
  const spacing = clamp(round2(Number(tune.spacing.input.value)), 0.75, 1.5);
  current.seed.color.brandHue = hue;
  current.seed.shape.radiusPx = radius;
  current.seed.shape.spacingScale = spacing;
  showTune(hue, radius, spacing);
  scheduleRender();
}

function scheduleRender() {
  if (state.timer !== 0) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = 0;
    void renderCurrent();
  }, ADJUST_DELAY_MS);
}

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  syncTune();
  void renderCurrent();
}

// コントラストの点検の結果を伝える
function showChecks(payload) {
  const tune = state.tune;
  if (tune === null) return;
  const failed = numberOf(payload.failed, 0);
  if (failed > 0) {
    setNote(
      tune.note,
      `色のコントラストの点検で、基準に届かない組み合わせが ${String(failed)} 件あります。色相を動かして試してください。`,
      true,
    );
    return;
  }
  setNote(tune.note, "色のコントラストの点検は通っています。", false);
}

async function renderCurrent() {
  const tune = state.tune;
  const current = state.current;
  if (tune === null || current === null) return;
  setNote(tune.note, "骨組みを描いています…", false);
  const payload = await renderInto(tune.preview, current, state.mode);
  if (payload === null) {
    setNote(tune.note, "", false); // 描けなかったことは iframe の下に出る
    return;
  }
  showChecks(payload);
}

function renderAllPreviews() {
  for (const item of state.directionPreviews) void renderInto(item.entry, item.direction, undefined);
  void renderCurrent();
}

async function createPage() {
  const current = state.current;
  const ui = state.pageUi;
  if (current === null || ui === null) {
    setStatus("先に方向性を選んでください。", true);
    return;
  }
  if (state.busy) return;
  const prompt = currentPrompt();
  if (prompt === "") {
    setStatus("ページを作るには、一言が必要です。上の入力欄に書いてください。", true);
    return;
  }
  const pageType = state.pageType; // 送る前に固定する (待つ間に画面の種類を変えても、できたページの扱いが混ざらないように)
  const session = nextSession();
  state.busy = true;
  ui.button.disabled = true;
  setNote(ui.note, "", false);
  const stop = startElapsed(ui.progress, "ページを作っています…");
  try {
    const payload = await requestJson("/api/page", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt, direction: current, pageType }),
    });
    if (state.session !== session) return; // あとから始めた作業がある → この応答は捨てる (進行の表示と busy は finally で戻す)
    const html = text(record(payload).html);
    if (html === "") throw new Error("ページが返りませんでした");
    setPage({ html, pageType });
    setNote(ui.note, `ページができました (${pageLabel(pageType)})。「別タブで開く」か「HTML をダウンロード」で取り出せます。`, false);
  } catch (error) {
    if (state.session !== session) return;
    setNote(ui.note, `ページを作れませんでした: ${errorMessage(error)}。もう一度「このページを作る」を押してください。`, true);
  } finally {
    stop();
    ui.progress.textContent = "";
    state.busy = false;
    ui.button.disabled = false;
  }
}

// HTML の属性用のエスケープ (& " < > を文字参照にする)
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 「別タブで開く」用の文書。LLM のページは、スクリプトだけ許した不透明なオリジンの iframe に入れる
// (アプリと同じオリジンの文書として開くと、ページの中のスクリプトから /api を読み書きできてしまうため)。
// 包みにはスクリプトも CSP の meta も置かない (srcdoc は親の CSP を引き継ぐので、Tailwind の browser 版が止まる)
function wrappedPageDocument(html) {
  const srcdoc = escapeAttribute(html);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>作ったページ</title></head><body style="margin:0"><iframe title="作ったページ" sandbox="allow-scripts" srcdoc="${srcdoc}" style="position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff"></iframe></body></html>`;
}

// 取り出し用の Blob (開く用とダウンロード用) を両方消す
function releasePage() {
  const page = state.page;
  if (page === null) return;
  URL.revokeObjectURL(page.openUrl);
  URL.revokeObjectURL(page.downloadUrl);
  state.page = null;
}

// 作ったページを大きめの iframe に出し、取り出しのボタンを出す。null で消す
function setPage(page) {
  const ui = state.pageUi;
  if (ui === null) return;
  releasePage();
  if (page === null) {
    ui.actions.hidden = true;
    ui.note.textContent = "";
    ui.preview.wrap.hidden = true;
    return;
  }
  const openUrl = URL.createObjectURL(new Blob([wrappedPageDocument(page.html)], { type: "text/html" }));
  const downloadUrl = URL.createObjectURL(new Blob([page.html], { type: "text/html" }));
  state.page = { html: page.html, pageType: page.pageType, openUrl, downloadUrl };
  ui.actions.hidden = false;
  ui.preview.wrap.hidden = false;
  ui.note.textContent = `表示中: ${pageLabel(page.pageType)} のページ`;
  setFrameHtml(ui.preview, page.html);
}

function pageFileName(pageType) {
  const base = state.projectId === null ? slugOf(currentPrompt()) : state.projectId;
  return `${base}-${pageType}.html`;
}

function openPage() {
  const page = state.page;
  if (page === null) return;
  window.open(page.openUrl, "_blank", "noopener");
}

function downloadPage() {
  const page = state.page;
  if (page === null) return;
  const link = document.createElement("a");
  link.href = page.downloadUrl;
  link.download = pageFileName(page.pageType);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

async function saveProject() {
  const current = state.current;
  const ui = state.saveUi;
  if (current === null) {
    setStatus("先に方向性を選んでください。", true);
    return;
  }
  if (ui === null || state.busy) return;
  const prompt = currentPrompt();
  if (prompt === "") {
    setStatus("保存には一言が必要です。上の入力欄に書いてください。", true);
    return;
  }
  if (state.projectId === null) state.projectId = makeProjectId(prompt);
  const page = state.page;
  const project = { id: state.projectId, prompt, pageType: page === null ? state.pageType : page.pageType, direction: current, pages: [] };
  const body = { project };
  if (page !== null) {
    body.pageType = page.pageType;
    body.html = page.html;
  }
  state.busy = true;
  ui.button.disabled = true;
  setNote(ui.note, "保存しています…", false);
  try {
    const payload = await requestJson("/api/projects", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const saved = record(record(payload).project);
    if (text(saved.id) !== "") state.projectId = text(saved.id);
    setNote(ui.note, `保存しました: ${state.projectId}`, false);
    await loadProjects();
  } catch (error) {
    setNote(ui.note, `保存できませんでした: ${errorMessage(error)}`, true);
  } finally {
    state.busy = false;
    ui.button.disabled = false;
  }
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function projectItem(raw) {
  const project = record(raw);
  const id = text(project.id);
  const item = el("li", "wb-project");
  const info = el("div");
  info.append(el("p", null, `${text(project.name)} — ${text(project.prompt)}`));
  const pages = (Array.isArray(project.pages) ? project.pages : []).filter((page) => typeof page === "string").map(pageLabel);
  const detail = `${dateLabel(text(project.updatedAt))} に更新${pages.length === 0 ? "" : ` / ページ: ${pages.join(" / ")}`}`;
  info.append(el("p", "wb-note", detail));
  const open = el("button", "btn", "開き直す");
  open.type = "button";
  open.disabled = id === "";
  open.addEventListener("click", () => {
    void openProject(id);
  });
  item.append(info, open);
  return item;
}

async function loadProjects() {
  const list = state.projectsList;
  if (list === null) return;
  let payload = null;
  try {
    payload = await requestJson("/api/projects");
  } catch (error) {
    list.replaceChildren(el("li", "wb-note status-error", `保存済みの一覧を読み込めませんでした: ${errorMessage(error)}`));
    return;
  }
  const projects = Array.isArray(record(payload).projects) ? record(payload).projects : [];
  if (projects.length === 0) {
    list.replaceChildren(el("li", "wb-note", "まだ保存したものはありません。"));
    return;
  }
  list.replaceChildren(...projects.map((project) => projectItem(project)));
}

// 保存したページのうち 1 枚 (プロジェクトの画面の種類) を読み込む。無ければ null
async function loadPage(projectId, project) {
  const pages = (Array.isArray(project.pages) ? project.pages : []).filter((page) => typeof page === "string");
  const wanted = pages.includes(text(project.pageType)) ? text(project.pageType) : pages[0];
  if (wanted === undefined) return null;
  const html = await requestText(`/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(wanted)}`);
  return { html, pageType: pageTypeOf(wanted) };
}

// 保存したプロジェクトを 1 件読み込む (GET /api/projects/<id>)。方向性が無ければエラー
async function fetchProject(id) {
  const payload = await requestJson(`/api/projects/${encodeURIComponent(id)}`);
  const project = record(record(payload).project);
  const direction = record(project.direction);
  if (Object.keys(direction).length === 0) throw new Error("方向性が入っていません");
  return {
    id: text(project.id) === "" ? id : text(project.id),
    name: text(project.name),
    prompt: text(project.prompt),
    pageType: text(project.pageType),
    pages: project.pages,
    direction,
  };
}

async function openProject(id) {
  if (state.busy || id === "") return;
  let session = nextSession();
  state.busy = true;
  setStatus("保存したプロジェクトを読み込んでいます…", false);
  try {
    const project = await fetchProject(id);
    if (state.session !== session) return; // あとから始めた作業がある → この応答は捨てる
    state.projectId = project.id;
    state.prompt = project.prompt;
    if (state.ui !== null) state.ui.prompt.value = state.prompt;
    beginDirections([project.direction]);
    session = state.session; // beginDirections で進んだ世代を、続きの目印にする
    setPageType(project.pageType);
    const page = await loadPage(project.id, project);
    if (state.session !== session) return;
    if (page !== null) setPage(page);
    setStatus(`保存した「${project.name}」を開きました。`, false);
  } catch (error) {
    if (state.session !== session) return;
    setStatus(`プロジェクトを開けませんでした: ${errorMessage(error)}`, true);
  } finally {
    state.busy = false;
  }
}

function switchToWorkbench() {
  const tab = document.querySelector('button[data-tab="workbench"]');
  if (tab !== null) tab.click();
}

// 見本帳の 1 枚から始める。スタイルを方向性 1 つとして読み込み、手順 3 から進める
async function startFromStyle(styleId, pageType) {
  if (styleId === "") return;
  const session = nextSession(); // 待っている間に始まった案・ページ・開き直しより、こちらを新しい作業にする
  setStatus(`スタイル「${styleId}」を読み込んでいます…`, false);
  let payload = null;
  try {
    payload = await requestJson("/api/styles");
  } catch (error) {
    if (state.session !== session) return;
    setStatus(`スタイルを読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  if (state.session !== session) return; // あとから始めた作業がある → この応答は捨てる
  const styles = Array.isArray(record(payload).styles) ? record(payload).styles : [];
  const style = styles.map((item) => record(item)).find((item) => text(item.id) === styleId);
  if (style === undefined) {
    setStatus(`スタイル「${styleId}」が見つかりませんでした。`, true);
    return;
  }
  state.projectId = null;
  state.prompt = text(style.name);
  if (state.ui !== null && state.ui.prompt.value.trim() === "") state.ui.prompt.value = state.prompt;
  beginDirections([style]);
  setPageType(pageType);
  setStatus(`スタイル「${text(style.name)}」から始めます。骨組みを調整してください。`, false);
}

window.addEventListener("studio:start-from-style", (event) => {
  if (state.ui === null) return; // 殻に作業台が無いときは何もしない
  const detail = event instanceof CustomEvent ? record(event.detail) : {};
  switchToWorkbench();
  void startFromStyle(text(detail.styleId), pageTypeOf(detail.pageType));
});

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = WORKBENCH_CSS;
  document.head.append(style);
}

function load() {
  const root = document.getElementById("workbench");
  if (root === null) return;
  injectStyles();
  root.replaceChildren();
  root.append(
    el("h2", "screen-title", "作業台"),
    el("p", "screen-lead", "曖昧な一言から方向性の案を出し、骨組みで見比べて選ぶか混ぜ、調整して、ページを作って保存できます。"),
  );
  state.status = el("p", "status");
  root.append(state.status);
  state.panels.input = buildInputPanel();
  state.panels.directions = buildDirectionsPanel();
  state.panels.axes = buildAxesPanel();
  state.panels.tune = buildTunePanel();
  state.panels.page = buildPagePanel();
  state.panels.save = buildSavePanel();
  root.append(state.panels.input, state.panels.directions, state.panels.axes, state.panels.tune, state.panels.page, state.panels.save);
  void loadProjects();
}

void load();
