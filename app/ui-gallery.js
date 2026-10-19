// 見本帳の画面。見本帳の中の切り替えで「スタイル × 画面の種類」と「表現」を出す。
// スタイル × 画面の種類: /gallery/<styleId>/<pageType>.html を縮小した iframe で並べ、
// マスを押すと大きく開いてテーマとライト/ダークを見比べられる。骨組みの種類と列の見出しは PAGE_TYPES。
// 表現: 面ごとの部品帳 (/api/gallery の surfaceSheets) と、動きの見本 (/api/treatments の motions)。
// 表現の中身は初めて開いたときに読み込み、表に戻したら動く見本の iframe を止める。
const PAGE_TYPES = [
  { key: "lp", label: "LP", always: true },
  { key: "dashboard", label: "ダッシュボード", always: true },
  { key: "blog", label: "ブログ記事", always: true },
  { key: "pricing", label: "料金ページ", always: false },
  { key: "product", label: "商品詳細", always: false },
  { key: "portfolio", label: "ポートフォリオ", always: false },
  { key: "settings", label: "設定画面", always: false },
];

const TABS = [
  { key: "styles", label: "スタイル × 画面の種類" },
  { key: "expression", label: "表現" },
];

const state = {
  styles: [],
  items: [],
  surfaceSheets: [],
  surfaces: [],
  overlay: null,
  view: null,
  expression: null,
  expressionOpen: false,
  expressionLoaded: false,
  expressionLoading: false,
  motionFrames: [],
};

// 動きの見本の HTML。2 回目からは読み直さない
const motionPreviewCache = new Map();

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className !== null && className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const text = (value) => (typeof value === "string" ? value : "");

const record = (value) => (value !== null && typeof value === "object" ? value : {});

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

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

function normalizeStyle(raw) {
  const style = record(raw);
  const id = text(style.id);
  return { id, name: text(style.name) === "" ? id : text(style.name), description: text(style.description) };
}

function normalizeItem(raw) {
  const item = record(raw);
  return { styleId: text(item.styleId), pageType: text(item.pageType), url: text(item.url) };
}

function normalizeSurfaceSheet(raw) {
  const sheet = record(raw);
  const surface = text(sheet.surface);
  return { surface, name: text(sheet.name) === "" ? surface : text(sheet.name), url: text(sheet.url) };
}

function normalizeSurface(raw) {
  const surface = record(raw);
  const id = text(surface.id);
  return { id, name: text(surface.name) === "" ? id : text(surface.name), description: text(surface.description) };
}

function normalizeMotion(raw) {
  const motion = record(raw);
  const id = text(motion.id);
  return {
    id,
    name: text(motion.name) === "" ? id : text(motion.name),
    description: text(motion.description),
    uses: Array.isArray(motion.uses) ? motion.uses.map((item) => text(item)).filter((item) => item !== "") : [],
    support: text(motion.support),
    supportNote: text(motion.supportNote),
    continuous: motion.continuous === true,
    scrollLinked: motion.scrollLinked === true,
  };
}

function pageLabel(pageType) {
  const found = PAGE_TYPES.find((page) => page.key === pageType);
  return found === undefined ? pageType : found.label;
}

function styleById(styleId) {
  const found = state.styles.find((style) => style.id === styleId);
  return found === undefined ? { id: styleId, name: styleId, description: "" } : found;
}

function urlOf(styleId, pageType) {
  const found = state.items.find((item) => item.styleId === styleId && item.pageType === pageType);
  return found === undefined || found.url === "" ? null : found.url;
}

function setStatus(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("status-error", isError === true);
}

function labeled(caption, control) {
  const field = el("label", "field");
  field.append(el("span", null, caption), control);
  return field;
}

function modeButton(label, mode) {
  const button = el("button", "btn", label);
  button.type = "button";
  button.dataset.mode = mode;
  return button;
}

// 見本の文書 (同じオリジン) の data-mode を差し替える
function applyMode(frame, current, mode, light, dark) {
  current.mode = mode;
  const doc = frame.contentDocument;
  if (doc !== null) doc.documentElement.setAttribute("data-mode", mode);
  light.setAttribute("aria-pressed", String(mode === "light"));
  dark.setAttribute("aria-pressed", String(mode === "dark"));
}

function syncMode(frame, current, light, dark) {
  const doc = frame.contentDocument;
  if (doc === null) return;
  const mode = doc.documentElement.getAttribute("data-mode") === "dark" ? "dark" : "light";
  applyMode(frame, current, mode, light, dark);
}

function contentElement(frame, id) {
  const doc = frame.contentDocument;
  return doc === null ? null : doc.getElementById(id);
}

// テーマの差し替え: #theme の中身・#theme-fonts の href・<html> の data-theme を入れ替える
async function switchTheme(frame, styleId, current, status) {
  if (styleId === current.themeId) return;
  setStatus(status, "テーマを差し替えています…", false);
  let theme = null;
  try {
    theme = await requestJson(`/api/themes/${encodeURIComponent(styleId)}`);
  } catch (error) {
    setStatus(status, `テーマを読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  const themeStyle = contentElement(frame, "theme");
  if (themeStyle === null) {
    setStatus(status, "見本がまだ読み込まれていません。少し待ってから、もう一度選んでください。", true);
    return;
  }
  themeStyle.textContent = text(theme.cssForPage);
  const fonts = contentElement(frame, "theme-fonts");
  if (fonts !== null && text(theme.fontsUrl) !== "") fonts.setAttribute("href", text(theme.fontsUrl));
  const doc = frame.contentDocument;
  if (doc !== null && text(theme.themeId) !== "") doc.documentElement.setAttribute("data-theme", text(theme.themeId));
  current.themeId = styleId;
  setStatus(status, `${styleById(styleId).name} のテーマに差し替えました。`, false);
}

function themeSelect(styleId) {
  const select = document.createElement("select");
  for (const style of state.styles) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    if (style.id === styleId) option.selected = true;
    select.append(option);
  }
  return select;
}

function startButton(styleId, pageType) {
  const button = el("button", "btn btn-primary", "これに近いもので作る");
  button.type = "button";
  button.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("studio:start-from-style", { detail: { styleId, pageType } }));
    closeOverlay();
  });
  return button;
}

function onOverlayKey(event) {
  if (event.key === "Escape") closeOverlay();
}

function closeOverlay() {
  const open = state.overlay;
  if (open === null) return;
  state.overlay = null;
  document.removeEventListener("keydown", onOverlayKey);
  open.overlay.remove();
  if (open.opener !== null && typeof open.opener.focus === "function") open.opener.focus();
}

// テーマの差し替えの操作。見本帳の表のマスから開いたときだけ出す
function themeField(styleId, frame, current, status) {
  const select = themeSelect(styleId);
  select.addEventListener("change", () => {
    void switchTheme(frame, select.value, current, status);
  });
  return labeled("テーマを差し替える", select);
}

// 大きく開く画面。styleId を渡すとテーマの差し替えと「これに近いもので作る」を出し、
// 渡さない (面ごとの部品帳) ときはライト / ダークの切り替えと閉じるだけにする
function openOverlay(options) {
  closeOverlay();
  const url = options.url;
  const title = options.title;
  const styleId = typeof options.styleId === "string" && options.styleId !== "" ? options.styleId : null;
  const overlay = el("div", "overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);

  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = `${title} の見本`;
  const body = el("div", "overlay-body");
  body.append(frame);

  const bar = el("div", "overlay-bar");
  bar.append(el("h2", "overlay-title", title));
  const controls = el("div", "overlay-controls");
  bar.append(controls);

  const status = el("p", "status overlay-status");
  const panel = el("div", "overlay-panel");
  panel.append(bar);
  if (styleId !== null) panel.append(status);
  panel.append(body);
  overlay.append(panel);

  const light = modeButton("ライト", "light");
  const dark = modeButton("ダーク", "dark");
  const seg = el("div", "seg");
  seg.append(light, dark);
  const close = el("button", "btn", "閉じる");
  close.type = "button";
  const current = { themeId: styleId ?? "", mode: "light" };

  if (styleId !== null) controls.append(themeField(styleId, frame, current, status));
  controls.append(labeled("表示", seg));
  if (styleId !== null) controls.append(startButton(styleId, options.pageType));
  controls.append(close);

  light.addEventListener("click", () => {
    applyMode(frame, current, "light", light, dark);
  });
  dark.addEventListener("click", () => {
    applyMode(frame, current, "dark", light, dark);
  });
  close.addEventListener("click", () => {
    closeOverlay();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOverlay();
  });
  frame.addEventListener("load", () => {
    syncMode(frame, current, light, dark);
  });

  document.body.append(overlay);
  state.overlay = { overlay, opener: document.activeElement };
  document.addEventListener("keydown", onOverlayKey);
  applyMode(frame, current, "light", light, dark);
  close.focus();
}

function cell(style, pageType) {
  const label = `${style.name} の ${pageLabel(pageType)}`;
  const url = urlOf(style.id, pageType);
  if (url === null) {
    const empty = el("div", "thumb thumb-empty");
    empty.append(el("span", null, "まだありません"));
    empty.setAttribute("aria-label", `${label} の見本はまだありません`);
    return empty;
  }
  const box = el("div", "thumb");
  box.setAttribute("role", "button");
  box.setAttribute("tabindex", "0");
  box.setAttribute("aria-label", `${label} を大きく開く`);
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = `${label} の見本`;
  frame.loading = "lazy";
  frame.setAttribute("tabindex", "-1");
  box.append(frame);
  box.addEventListener("click", () => {
    openOverlay({ title: label, url, styleId: style.id, pageType });
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOverlay({ title: label, url, styleId: style.id, pageType });
  });
  return box;
}

// 列に出す骨組みの種類 (いつも出す 3 つと、見本が 1 枚でもある種類)
function visiblePageTypes() {
  return PAGE_TYPES.filter((page) => page.always || state.items.some((item) => item.pageType === page.key));
}

function buildGrid() {
  const scroll = el("div", "gallery-scroll");
  const grid = el("div", "gallery-grid");
  const pages = visiblePageTypes();
  grid.style.setProperty("--gallery-cols", String(pages.length));
  grid.append(el("div", null, ""));
  for (const page of pages) grid.append(el("div", "gallery-col", page.label));
  for (const style of state.styles) {
    const head = el("div", "gallery-style");
    head.append(el("h3", null, style.name), el("p", null, style.description));
    grid.append(head);
    for (const page of pages) grid.append(cell(style, page.key));
  }
  scroll.append(grid);
  return scroll;
}

// ---------------------------------------------------------------- 見本帳の中の切り替え

function tabButtonOf(tab) {
  const button = el("button", "gallery-tab", tab.label);
  button.type = "button";
  button.id = `gallery-tab-${tab.key}`;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", `gallery-${tab.key}-panel`);
  button.addEventListener("click", () => {
    selectTab(tab.key);
  });
  return button;
}

function panelOf(tab) {
  const panel = el("div", "gallery-panel");
  panel.id = `gallery-${tab.key}-panel`;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `gallery-tab-${tab.key}`);
  return panel;
}

function selectTab(key) {
  const view = state.view;
  if (view === null) return;
  for (const [tabKey, button] of view.tabs) {
    const selected = tabKey === key;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  view.active = key;
  view.stylesPanel.hidden = key !== "styles";
  view.expressionPanel.hidden = key !== "expression";
  state.expressionOpen = key === "expression";
  if (key === "expression") openExpression();
  else stopMotionPreviews();
}

// 「表現」を初めて開いたときだけ一覧を読む。失敗したら、もう一度開いたときに読み直す
function openExpression() {
  if (!state.expressionLoaded) {
    if (!state.expressionLoading) void loadExpression();
    return;
  }
  restoreMotionPreviews();
}

// ---------------------------------------------------------------- 表現: 面ごとの部品帳

function surfaceRows() {
  const rows = [];
  for (const surface of state.surfaces) {
    const sheet = state.surfaceSheets.find((item) => item.surface === surface.id);
    rows.push({ id: surface.id, name: surface.name, description: surface.description, url: sheet === undefined ? "" : sheet.url });
  }
  // 台帳に無い面のシートがあれば、末尾に足して見せる
  for (const sheet of state.surfaceSheets) {
    if (rows.some((row) => row.id === sheet.surface)) continue;
    rows.push({ id: sheet.surface, name: sheet.name, description: "", url: sheet.url });
  }
  return rows;
}

function openSurfaceSheet(name, url) {
  openOverlay({ title: `${name} の部品帳`, url, styleId: null });
}

function surfaceBoxOf(row) {
  if (row.url === "") {
    const empty = el("div", "thumb thumb-empty surface-thumb");
    empty.append(el("span", null, "まだありません"));
    empty.setAttribute("aria-label", `${row.name} の部品帳はまだありません`);
    return empty;
  }
  const box = el("div", "thumb surface-thumb");
  box.setAttribute("role", "button");
  box.setAttribute("tabindex", "0");
  box.setAttribute("aria-label", `${row.name} の部品帳を大きく開く`);
  const frame = document.createElement("iframe");
  frame.src = row.url;
  frame.title = `${row.name} の部品帳`;
  frame.loading = "lazy";
  frame.setAttribute("tabindex", "-1");
  box.append(frame);
  box.addEventListener("click", () => {
    openSurfaceSheet(row.name, row.url);
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSurfaceSheet(row.name, row.url);
  });
  return box;
}

function surfaceItemOf(row) {
  const item = el("div", "surface-item");
  item.append(surfaceBoxOf(row));
  item.append(el("h4", "surface-name", row.name));
  if (row.description !== "") item.append(el("p", "surface-desc", row.description));
  return item;
}

function renderSurfaceSheets(ui) {
  const rows = surfaceRows();
  ui.surfaceGrid.replaceChildren(...rows.map(surfaceItemOf));
  setStatus(ui.surfaceStatus, rows.length === 0 ? "面ごとの部品帳はまだありません。" : "", false);
}

// ---------------------------------------------------------------- 表現: 動きの見本

function supportLabel(support) {
  if (support === "fallback") return "Chromium だけ (代わりの見た目あり)";
  if (support === "baseline") return "主要ブラウザ";
  return support;
}

function motionBadgesOf(motion) {
  const badges = el("div", "badges");
  const support = supportLabel(motion.support);
  if (support !== "") badges.append(el("span", "badge", support));
  if (motion.continuous) badges.append(el("span", "badge", "ずっと動く"));
  if (motion.scrollLinked) badges.append(el("span", "badge", "スクロール連動"));
  return badges;
}

function motionCardOf(motion) {
  const card = el("article", "motion-card");
  const head = el("div", "motion-card-head");
  head.append(el("h4", "motion-name", motion.name), motionBadgesOf(motion));
  card.append(head);
  if (motion.description !== "") card.append(el("p", "motion-desc", motion.description));
  if (motion.uses.length > 0) card.append(el("p", "motion-meta", `使いどころ: ${motion.uses.join("・")}`));
  if (motion.supportNote !== "") card.append(el("p", "motion-meta", motion.supportNote));
  const frame = document.createElement("iframe");
  frame.className = motion.scrollLinked ? "motion-frame motion-frame-scroll" : "motion-frame";
  frame.title = `${motion.name} の動きの見本`;
  frame.setAttribute("sandbox", "allow-scripts");
  card.append(frame);
  state.motionFrames.push({ id: motion.id, frame });
  return card;
}

async function fetchMotionHtml(id) {
  const response = await fetch(`/api/motions/${encodeURIComponent(id)}/preview`);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return response.text();
}

// 読み込んだ HTML を srcdoc に入れる。表を出している間は入れず、開いたときに戻す
async function fillMotionFrame(entry) {
  try {
    const html = motionPreviewCache.get(entry.id) ?? (await fetchMotionHtml(entry.id));
    motionPreviewCache.set(entry.id, html);
    if (state.expressionOpen) entry.frame.srcdoc = html;
  } catch (error) {
    entry.frame.hidden = true;
    entry.frame.after(el("p", "status status-error", `見本を読み込めませんでした: ${errorMessage(error)}`));
  }
}

function stopMotionPreviews() {
  for (const entry of state.motionFrames) entry.frame.srcdoc = "";
}

function restoreMotionPreviews() {
  for (const entry of state.motionFrames) {
    const html = motionPreviewCache.get(entry.id);
    if (html !== undefined) entry.frame.srcdoc = html;
  }
}

function renderMotionCards(ui, motions) {
  state.motionFrames = [];
  if (motions.length === 0) {
    ui.motionGrid.replaceChildren();
    setStatus(ui.motionStatus, "動きの見本はまだありません。", false);
    return;
  }
  setStatus(ui.motionStatus, "", false);
  ui.motionGrid.replaceChildren(...motions.map(motionCardOf));
  for (const entry of state.motionFrames) void fillMotionFrame(entry);
}

// ---------------------------------------------------------------- 表現: 読み込み

function buildExpressionSections() {
  const surfaceGrid = el("div", "surface-strip");
  surfaceGrid.setAttribute("aria-label", "面ごとの部品帳");
  const surfaceStatus = el("p", "status");
  const surfaceSection = el("section", "expression-section");
  const surfaceTitle = el("h3", "expression-title", "面ごとの部品帳");
  surfaceTitle.id = "gallery-surface-title";
  surfaceSection.setAttribute("aria-labelledby", surfaceTitle.id);
  surfaceSection.append(
    surfaceTitle,
    el(
      "p",
      "expression-lead",
      "スタイルはミニマルに固定し、動きなしで、同じ依頼・同じ部品・同じ文言の見本データを使い、面だけを変えた 4 枚です。マスを押すと大きく開きます。",
    ),
    surfaceStatus,
    surfaceGrid,
  );

  const motionGrid = el("div", "motion-grid");
  motionGrid.setAttribute("aria-label", "動きの見本");
  const motionStatus = el("p", "status");
  const motionSection = el("section", "expression-section");
  const motionTitle = el("h3", "expression-title", "動きの見本");
  motionTitle.id = "gallery-motion-title";
  motionSection.setAttribute("aria-labelledby", motionTitle.id);
  motionSection.append(
    motionTitle,
    el("p", "expression-lead", "ミニマルのテーマで動かしている動きの見本です。カードの中で実際に動きます。"),
    motionStatus,
    motionGrid,
  );

  return { surfaceGrid, surfaceStatus, motionGrid, motionStatus, sections: [surfaceSection, motionSection] };
}

function ensureExpressionUi() {
  if (state.expression !== null) return state.expression;
  const view = state.view;
  if (view === null) return null;
  const ui = buildExpressionSections();
  view.expressionPanel.append(...ui.sections);
  state.expression = ui;
  return ui;
}

async function loadExpression() {
  const ui = ensureExpressionUi();
  if (ui === null) return;
  state.expressionLoading = true;
  setStatus(ui.surfaceStatus, "読み込んでいます…", false);
  setStatus(ui.motionStatus, "読み込んでいます…", false);
  try {
    const payload = record(await requestJson("/api/treatments"));
    const surfaces = Array.isArray(payload.surfaces) ? payload.surfaces.map(normalizeSurface).filter((item) => item.id !== "") : [];
    const motions = Array.isArray(payload.motions) ? payload.motions.map(normalizeMotion).filter((item) => item.id !== "") : [];
    state.surfaces = surfaces;
    renderSurfaceSheets(ui);
    renderMotionCards(ui, motions);
    state.expressionLoaded = true;
  } catch (error) {
    const message = `表現の一覧を読み込めませんでした: ${errorMessage(error)}`;
    setStatus(ui.surfaceStatus, message, true);
    setStatus(ui.motionStatus, message, true);
  } finally {
    state.expressionLoading = false;
  }
}

// ---------------------------------------------------------------- 画面の組み立て

function buildView() {
  const tabs = el("div", "gallery-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "見本帳の表示");
  const view = {
    tabs: new Map(),
    active: "styles",
    stylesPanel: panelOf(TABS[0]),
    expressionPanel: panelOf(TABS[1]),
  };
  view.expressionPanel.hidden = true;
  state.view = view;
  for (const tab of TABS) {
    const button = tabButtonOf(tab);
    view.tabs.set(tab.key, button);
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const keys = TABS.map((tab) => tab.key);
    const at = keys.indexOf(view.active);
    const next = event.key === "ArrowRight" ? (at + 1) % keys.length : (at - 1 + keys.length) % keys.length;
    const key = keys[next];
    selectTab(key);
    view.tabs.get(key)?.focus();
  });
  view.stylesPanel.append(buildGrid());
  return { tabs, view };
}

async function load() {
  const root = document.getElementById("gallery");
  if (root === null) return;
  root.append(
    el("h2", "screen-title", "見本帳"),
    el("p", "screen-lead", "スタイルと画面の種類の見本と、面・動きの表現の見本です。マスを押すと大きく開き、見比べられます。"),
  );
  const status = el("p", "status");
  root.append(status);

  let payloads = null;
  try {
    payloads = await Promise.all([requestJson("/api/styles"), requestJson("/api/gallery")]);
  } catch (error) {
    setStatus(status, `見本帳を読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  const stylesValue = record(payloads[0]).styles;
  const itemsValue = record(payloads[1]).items;
  const sheetsValue = record(payloads[1]).surfaceSheets;
  state.styles = (Array.isArray(stylesValue) ? stylesValue : []).map(normalizeStyle);
  state.items = (Array.isArray(itemsValue) ? itemsValue : []).map(normalizeItem);
  state.surfaceSheets = (Array.isArray(sheetsValue) ? sheetsValue : []).map(normalizeSurfaceSheet).filter((item) => item.surface !== "");
  if (state.styles.length === 0) {
    setStatus(status, "スタイルがありません。", true);
    return;
  }
  const built = buildView();
  root.append(built.tabs, built.view.stylesPanel, built.view.expressionPanel);
  selectTab("styles");
}

void load();
