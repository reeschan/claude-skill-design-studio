// 見本帳の画面。スタイル × 画面の種類の見本 (/gallery/<styleId>/<pageType>.html) を
// 縮小した iframe で並べ、マスを押すと大きく開いてテーマとライト/ダークを見比べられる。
// 「これに近いもので作る」で studio:start-from-style を投げ、作業台 (PBI-015) に渡す
// 骨組みの種類と列の見出し。always の 3 つはいつも列を出し、ほかは見本が 1 枚でもあれば列を出す
const PAGE_TYPES = [
  { key: "lp", label: "LP", always: true },
  { key: "dashboard", label: "ダッシュボード", always: true },
  { key: "blog", label: "ブログ記事", always: true },
  { key: "pricing", label: "料金ページ", always: false },
  { key: "product", label: "商品詳細", always: false },
  { key: "portfolio", label: "ポートフォリオ", always: false },
  { key: "settings", label: "設定画面", always: false },
];

const state = { styles: [], items: [], overlay: null };

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

function openOverlay(styleId, pageType, url) {
  closeOverlay();
  const title = `${styleById(styleId).name} の ${pageLabel(pageType)}`;
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
  panel.append(bar, status, body);
  overlay.append(panel);

  const select = themeSelect(styleId);
  const light = modeButton("ライト", "light");
  const dark = modeButton("ダーク", "dark");
  const seg = el("div", "seg");
  seg.append(light, dark);
  const close = el("button", "btn", "閉じる");
  close.type = "button";
  controls.append(labeled("テーマを差し替える", select), labeled("表示", seg), startButton(styleId, pageType), close);

  const current = { themeId: styleId, mode: "light" };
  select.addEventListener("change", () => {
    void switchTheme(frame, select.value, current, status);
  });
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
    openOverlay(style.id, pageType, url);
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOverlay(style.id, pageType, url);
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

async function load() {
  const root = document.getElementById("gallery");
  if (root === null) return;
  root.append(
    el("h2", "screen-title", "見本帳"),
    el("p", "screen-lead", "スタイルと画面の種類の組み合わせの見本です。マスを押すと大きく開き、テーマを差し替えて見比べられます。"),
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
  state.styles = (Array.isArray(stylesValue) ? stylesValue : []).map(normalizeStyle);
  state.items = (Array.isArray(itemsValue) ? itemsValue : []).map(normalizeItem);
  if (state.styles.length === 0) {
    setStatus(status, "スタイルがありません。", true);
    return;
  }
  root.append(buildGrid());
}

void load();
