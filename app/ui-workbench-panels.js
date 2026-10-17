// 作業台の右の列の前半 (パッド 4 枚・微調整・コントラスト・トークン)。
// パッドの点は 0〜1 の x, y をそのまま /api/mix に送り、重みの計算はしない (ADR 0003)。
// 状態を変える処理と DOM を作る処理を分ける。状態・API・描き直しは呼び出し元 (ui-workbench.js) から受け取る。
const AXES = [
  { key: "color", label: "色" },
  { key: "font", label: "フォント" },
  { key: "shape", label: "形" },
  { key: "layout", label: "配置" },
];
// パッドの 4 隅。案は A=(0,0) 左上・B=(1,0) 右上・C=(0,1) 左下・D=(1,1) 右下 (core/types.ts)
const CORNERS = [
  { letter: "A", x: 0, y: 0, corner: "a" },
  { letter: "B", x: 1, y: 0, corner: "b" },
  { letter: "C", x: 0, y: 1, corner: "c" },
  { letter: "D", x: 1, y: 1, corner: "d" },
];
// 吸着の表示を出す軸 (フォントと配置は混ざらず、一番重い案のものになる)
const SNAP_LABELS = { font: "フォント", layout: "配置" };
// 矢印キー 1 回の動き (0.05 刻み)
const KEY_MOVES = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] };
const SHADOWS = [
  { value: "none", label: "なし" },
  { value: "soft", label: "柔らかい" },
  { value: "hard", label: "はっきり" },
];
const BASE_MODES = [
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];
// トークンの 3 形式と、保存するファイルの名前
const TOKEN_FORMATS = [
  { key: "tailwind", label: "Tailwind", file: "theme.css" },
  { key: "json", label: "JSON", file: "theme.json" },
  { key: "css", label: "CSS", file: "theme-vars.css" },
];
// トークンを待っている間に見た目が変わったときの案内 (古い応答は出さない・覚えない)
const TOKENS_STALE = "見た目が変わったので、形式を選ぶと読み込み直します。";
// ページを作る前に確かめること (画面の中だけの状態でよい)
const CHECKLIST = ["コントラストの基準を確かめた", "日本語フォントが読み込まれているか確かめた", "モバイルでの見え方を確かめた"];
const MIN_ITEMS = 3;
const MAX_ITEMS = 6;
const PANEL_CSS = `
.wb-pads { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 8px; }
.wb-pad-box { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wb-pad { position: relative; aspect-ratio: 1 / 1; border: 1px solid var(--line); border-radius: var(--radius-sm); background: radial-gradient(circle at 0 0, var(--glow-a), transparent 55%), radial-gradient(circle at 100% 100%, var(--glow-b), transparent 55%), repeating-linear-gradient(0deg, transparent 0 19px, color-mix(in oklch, var(--line) 55%, transparent) 19px 20px), repeating-linear-gradient(90deg, transparent 0 19px, color-mix(in oklch, var(--line) 55%, transparent) 19px 20px), var(--bg); user-select: none; }
.wb-pad-area { position: absolute; inset: 26px; touch-action: none; cursor: crosshair; }
.wb-dot { position: absolute; width: 18px; height: 18px; padding: 0; border: 2px solid var(--foreground); border-radius: 999px; background: var(--gradient); box-shadow: 2px 2px 0 0 var(--foreground); transform: translate(-50%, -50%); cursor: grab; }
.wb-dot:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
.wb-corner { position: absolute; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 10px; color: var(--muted); pointer-events: none; }
.wb-corner-a { left: 6px; top: 4px; }
.wb-corner-b { right: 6px; top: 4px; }
.wb-corner-c { left: 6px; bottom: 4px; }
.wb-corner-d { right: 6px; bottom: 4px; }
.wb-snap { margin: 0; font-size: 12.5px; color: var(--accent-soft-fg); }
.wb-tune-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.wb-tune-row:last-child { border-bottom: 0; }
.wb-tune-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wb-tune-body input[type="range"], .wb-tune-body select { width: 100%; }
.wb-tune-value { min-width: 3.2em; font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); text-align: right; }
.wb-tune-reset { padding: 2px 8px; font-size: 12px; }
.wb-checks { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.wb-tokens { max-height: 260px; overflow: auto; margin-top: 8px; }
`;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const round3 = (value) => Math.round(value * 1000) / 1000;
const fixed2 = (value) => value.toFixed(2);
const hueText = (value) => String(Math.round(value));
const radiusText = (value) => `${String(Math.round(value))}px`;

export function createPanels(ctx) {
  const { el, text, record, numberOf, errorMessage, requestJson, setNote, JSON_HEADERS, state } = ctx;
  const ui = { axes: {}, snap: {}, decide: [], tune: { copy: null }, tokens: {}, contrast: {} };
  const drag = { key: "", pointerId: -1 };
  // トークンの読み込み (混ぜた結果の id ごとに 1 回だけ読む)
  const tokens = { id: "", value: null, format: TOKEN_FORMATS[0].key, loading: false, again: false };
  // 最後に画面へ書いたページの文章。入力の途中で欄を作り直さないための目印
  let copySignature = "";

  function build(root) {
    injectStyles();
    root.append(buildPadsSection(), buildTuneSection(), buildContrastSection(), buildTokensSection());
    roundChanged();
    syncTune();
  }

  // 案が変わった (回の切り替え・出し直し・編集・開き直し) ときの描き直し
  function roundChanged() {
    const round = ctx.currentRound();
    const directions = round === null ? [] : ctx.effectiveDirections(round);
    for (const axis of AXES) {
      const entry = ui.axes[axis.key];
      if (entry === undefined) continue;
      CORNERS.forEach((corner, index) => {
        const label = entry.corners[index];
        const direction = record(directions[index]);
        if (directions[index] === undefined) {
          label.hidden = true;
          return;
        }
        label.hidden = false;
        label.textContent = `${corner.letter} ${text(direction.name)}`;
      });
    }
    ui.decide.forEach((button, index) => {
      button.disabled = directions[index] === undefined;
    });
    renderDots();
    renderSnapped(null);
  }

  function setPoints(points) {
    state.points = points;
    renderDots();
  }

  function setFineTune(fineTune) {
    state.fineTune = fineTune;
    syncTune();
  }

  // 混ぜた応答。パッドの吸着の表示と、微調整の初期値を新しいものにする (mixed は state にはいっている)
  function onMixed(snapped) {
    renderSnapped(record(snapped));
    syncTune();
    syncTokensStale();
  }

  function onRender(payload) {
    renderContrast(payload);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    document.head.append(style);
  }

  // ---------------------------------------------------------------- パッド 4 枚

  function buildPadsSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "pads";
    section.append(el("h3", null, "パッド"));
    section.append(
      el(
        "p",
        "wb-note",
        "4 隅が案 A〜D です。点をドラッグするか、点に合わせて矢印キーを押すと、混ぜ方が変わってプレビューを描き直します。",
      ),
    );
    section.append(buildDecideRow());
    const grid = el("div", "wb-pads");
    for (const axis of AXES) grid.append(buildPad(axis));
    section.append(grid);
    return section;
  }

  // 「この案で決める」で 4 軸の点をその案の隅にそろえる
  function buildDecideRow() {
    const row = el("div", "wb-row");
    row.append(el("span", "wb-caption", "この案で決める"));
    for (const corner of CORNERS) {
      const button = el("button", "btn", corner.letter);
      button.type = "button";
      button.title = `4 軸の点を案 ${corner.letter} の隅にそろえる`;
      button.addEventListener("click", () => {
        decideOn(corner);
      });
      row.append(button);
      ui.decide.push(button);
    }
    return row;
  }

  function buildPad(axis) {
    const box = el("div", "wb-pad-box");
    box.append(el("span", "wb-caption", axis.label));
    const pad = el("div", "wb-pad");
    const corners = CORNERS.map((corner) => {
      const label = el("span", `wb-corner wb-corner-${corner.corner}`);
      pad.append(label);
      return label;
    });
    const area = el("div", "wb-pad-area");
    const dot = el("button", "wb-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", `${axis.label}の点`);
    dot.addEventListener("keydown", (event) => {
      onDotKey(axis.key, event);
    });
    area.addEventListener("pointerdown", (event) => {
      startDrag(axis.key, area, event);
    });
    area.addEventListener("pointermove", (event) => {
      moveDrag(axis.key, area, event);
    });
    area.addEventListener("pointerup", endDrag);
    area.addEventListener("pointercancel", endDrag);
    area.append(dot);
    pad.append(area);
    box.append(pad);
    if (SNAP_LABELS[axis.key] !== undefined) {
      const snap = el("p", "wb-note wb-snap");
      snap.hidden = true;
      box.append(snap);
      ui.snap[axis.key] = snap;
    }
    ui.axes[axis.key] = { dot, corners };
    return box;
  }

  function startDrag(key, area, event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    drag.key = key;
    drag.pointerId = event.pointerId;
    try {
      area.setPointerCapture(event.pointerId);
    } catch {
      // 取れなくても位置は動かす
    }
    const dot = ui.axes[key]?.dot;
    if (dot !== undefined) dot.focus();
    writePoint(key, pointFromEvent(area, event));
  }

  function moveDrag(key, area, event) {
    if (drag.key !== key || drag.pointerId !== event.pointerId) return;
    writePoint(key, pointFromEvent(area, event));
  }

  function endDrag(event) {
    if (drag.pointerId !== event.pointerId) return;
    drag.key = "";
    drag.pointerId = -1;
  }

  // ポインターの位置を、パッドの中の 0〜1 の点にする (重みは計算しない。ADR 0003)
  function pointFromEvent(area, event) {
    const rect = area.getBoundingClientRect();
    const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const y = rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height;
    return { x: clamp01(round3(x)), y: clamp01(round3(y)) };
  }

  function onDotKey(key, event) {
    const move = KEY_MOVES[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const point = pointOf(key);
    writePoint(key, { x: clamp01(round3(point.x + move[0])), y: clamp01(round3(point.y + move[1])) });
  }

  function writePoint(key, point) {
    const current = pointOf(key);
    if (current.x === point.x && current.y === point.y) return;
    state.points = { ...state.points, [key]: point };
    renderDot(key);
    ctx.schedulePreview();
  }

  function decideOn(corner) {
    const points = {};
    for (const axis of AXES) points[axis.key] = { x: corner.x, y: corner.y };
    state.points = points;
    renderDots();
    ctx.schedulePreview();
  }

  function pointOf(key) {
    const point = record(record(state.points)[key]);
    return { x: clamp01(numberOf(point.x, 0)), y: clamp01(numberOf(point.y, 0)) };
  }

  function renderDots() {
    for (const axis of AXES) renderDot(axis.key);
  }

  function renderDot(key) {
    const axis = ui.axes[key];
    if (axis === undefined) return;
    const point = pointOf(key);
    const label = AXES.find((entry) => entry.key === key)?.label ?? key;
    axis.dot.style.left = `${String(point.x * 100)}%`;
    axis.dot.style.top = `${String(point.y * 100)}%`;
    axis.dot.title = `${label}の点 (x ${point.x.toFixed(2)}, y ${point.y.toFixed(2)})`;
  }

  // 吸着の表示 (フォント・配置)。snapped は 4 隅の案の添字
  function renderSnapped(snapped) {
    const round = ctx.currentRound();
    const directions = round === null ? [] : ctx.effectiveDirections(round);
    for (const key of Object.keys(SNAP_LABELS)) {
      const note = ui.snap[key];
      if (note === undefined) continue;
      const index = numberOf(record(snapped)[key], -1);
      const direction = record(directions[index]);
      if (directions[index] === undefined) {
        note.hidden = true;
        continue;
      }
      note.hidden = false;
      const name = text(direction.name);
      note.textContent = `${SNAP_LABELS[key]}: 案 ${CORNERS[index].letter}${name === "" ? "" : `「${name}」`}`;
    }
  }

  // ---------------------------------------------------------------- 微調整

  function buildTuneSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "tune";
    section.append(el("h3", null, "微調整"));
    section.append(
      el("p", "wb-note", "混ぜた値に重ねる調整です。変えた項目だけが効き、「戻す」で混ぜた値に戻ります。案とパッドの点は変わりません。"),
    );
    const body = el("div", "wb-tune");
    ui.tune.brandHue = sliderRow(body, "ブランドの色相", 0, 359, 1, hueText);
    ui.tune.brandChroma = sliderRow(body, "ブランドの彩度", 0, 0.4, 0.01, fixed2);
    ui.tune.accent = accentRow(body);
    ui.tune.contrast = sliderRow(body, "コントラスト", 1, 5, 0.1, fixed2);
    ui.tune.radiusPx = sliderRow(body, "角丸 (px)", 0, 32, 1, radiusText);
    ui.tune.spacingScale = sliderRow(body, "余白 (倍)", 0.75, 1.5, 0.05, fixed2);
    ui.tune.shadow = selectRow(body, "影", SHADOWS);
    ui.tune.baseMode = selectRow(body, "明るさ", BASE_MODES);
    ui.tune.font = selectRow(body, "フォントの組", []);
    ui.tune.layout = selectRow(body, "配置の型", []);
    ui.tune.copy = buildCopyGroup(body);
    tuneOn("brandHue", ui.tune.brandHue);
    tuneOn("brandChroma", ui.tune.brandChroma);
    tuneOn("contrast", ui.tune.contrast);
    tuneOn("radiusPx", ui.tune.radiusPx);
    tuneOn("spacingScale", ui.tune.spacingScale);
    selectOn("shadow", ui.tune.shadow);
    selectOn("baseMode", ui.tune.baseMode);
    ui.tune.font.select.addEventListener("change", onFontChange);
    ui.tune.font.reset.addEventListener("click", () => {
      clearTune("font");
    });
    ui.tune.layout.select.addEventListener("change", onLayoutChange);
    ui.tune.layout.reset.addEventListener("click", () => {
      clearTune("layouts");
    });
    section.append(body);
    return section;
  }

  // 微調整の 1 行 (見出し・操作・値・戻す)
  function tuneRow(parent, caption) {
    const row = el("div", "wb-tune-row");
    const body = el("div", "wb-tune-body");
    body.append(el("span", "wb-caption", caption));
    const value = el("span", "wb-tune-value");
    const reset = el("button", "btn wb-tune-reset", "戻す");
    reset.type = "button";
    row.append(body, value, reset);
    parent.append(row);
    return { row, body, value, reset };
  }

  function sliderRow(parent, caption, min, max, step, format) {
    const row = tuneRow(parent, caption);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute("aria-label", caption);
    row.body.append(input);
    return { row: row.row, input, value: row.value, reset: row.reset, format };
  }

  function selectRow(parent, caption, options) {
    const row = tuneRow(parent, caption);
    const select = document.createElement("select");
    select.className = "wb-input";
    select.setAttribute("aria-label", caption);
    replaceOptions(select, options);
    row.body.append(select);
    return { row: row.row, select, reset: row.reset };
  }

  function accentRow(parent) {
    const row = tuneRow(parent, "アクセントの色相");
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "359";
    input.step = "1";
    input.setAttribute("aria-label", "アクセントの色相");
    const none = document.createElement("input");
    none.type = "checkbox";
    const check = el("label", "wb-check", "なし");
    check.prepend(none);
    row.body.append(input, check);
    input.addEventListener("input", () => {
      if (!none.checked) setTune("accentHue", Number(input.value));
    });
    none.addEventListener("change", () => {
      setTune("accentHue", none.checked ? null : Number(input.value));
    });
    row.reset.addEventListener("click", () => {
      clearTune("accentHue");
    });
    return { row: row.row, input, none, value: row.value, reset: row.reset };
  }

  function buildCopyGroup(parent) {
    const group = el("div", "wb-group");
    group.append(el("span", "wb-caption", "ページの文章"));
    const grid = el("div", "wb-grid2");
    const headline = textInputOf(200);
    const lead = textInputOf(400);
    const cta = textInputOf(100);
    grid.append(fieldOf("見出し", headline), fieldOf("リード", lead), fieldOf("ボタン", cta));
    const itemsBox = el("div", "wb-items");
    const add = el("button", "btn", "項目を足す");
    add.type = "button";
    const note = el("p", "wb-note");
    const copy = { headline, lead, cta, itemsBox, add, note, rows: [] };
    add.addEventListener("click", () => {
      addCopyItem(copy);
    });
    for (const control of [headline, lead, cta]) {
      control.addEventListener("input", onCopyChange);
    }
    const reset = el("button", "btn wb-tune-reset", "戻す");
    reset.type = "button";
    reset.addEventListener("click", () => {
      clearTune("copy");
    });
    const footer = el("div", "wb-row");
    footer.append(note, reset);
    group.append(grid, el("span", "wb-caption", "項目 (3〜6 件)"), itemsBox, add, footer);
    parent.append(group);
    return copy;
  }

  function addCopyItem(copy) {
    if (copy.rows.length >= MAX_ITEMS) return;
    copy.rows.push(copyItemRow({ title: "", body: "" }, copy));
    refreshCopyItems(copy);
    onCopyChange();
  }

  function dropCopyItem(copy, row) {
    const at = copy.rows.findIndex((entry) => entry.row === row);
    if (at < 0) return;
    copy.rows.splice(at, 1);
    refreshCopyItems(copy);
    onCopyChange();
  }

  function copyItemRow(item, copy) {
    const row = el("div", "wb-item");
    const title = textInputOf(200);
    title.value = text(item.title);
    const body = document.createElement("textarea");
    body.className = "wb-input";
    body.rows = 2;
    body.maxLength = 600;
    body.value = text(item.body);
    const remove = el("button", "btn", "削除");
    remove.type = "button";
    remove.addEventListener("click", () => {
      dropCopyItem(copy, row);
    });
    title.addEventListener("input", onCopyChange);
    body.addEventListener("input", onCopyChange);
    row.append(fieldOf("見出し", title), fieldOf("本文", body), remove);
    return { row, title, body, remove };
  }

  function refreshCopyItems(copy) {
    copy.itemsBox.replaceChildren(...copy.rows.map((entry) => entry.row));
    copy.add.disabled = copy.rows.length >= MAX_ITEMS;
    for (const entry of copy.rows) entry.remove.disabled = copy.rows.length <= MIN_ITEMS;
  }

  function textInputOf(maxLength) {
    const input = document.createElement("input");
    input.className = "wb-input";
    input.maxLength = maxLength;
    return input;
  }

  function fieldOf(caption, control) {
    const label = el("label", "wb-field");
    label.append(el("span", "wb-caption", caption), control);
    return label;
  }

  function replaceOptions(select, options) {
    select.replaceChildren(
      ...options.map((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        return node;
      }),
    );
  }

  // 微調整のキーを 1 つ足す (変えた項目だけが fineTune に入る)
  function setTune(key, value) {
    state.fineTune = { ...state.fineTune, [key]: value };
    syncTune();
    ctx.schedulePreview();
  }

  // キーを 1 つ消して、その項目を混ぜた値に戻す
  function clearTune(key) {
    const next = { ...state.fineTune };
    delete next[key];
    state.fineTune = next;
    syncTune();
    ctx.schedulePreview();
  }

  function tuneOn(key, row) {
    row.input.addEventListener("input", () => {
      setTune(key, Number(row.input.value));
    });
    row.reset.addEventListener("click", () => {
      clearTune(key);
    });
  }

  function selectOn(key, row) {
    row.select.addEventListener("change", () => {
      setTune(key, row.select.value);
    });
    row.reset.addEventListener("click", () => {
      clearTune(key);
    });
  }

  function onFontChange() {
    const pair = ctx
      .fontPairs()
      .map((item) => record(item))
      .find((item) => text(item.id) === ui.tune.font.select.value);
    if (pair === undefined) {
      clearTune("font");
      return;
    }
    setTune("font", {
      mood: text(pair.mood),
      heading: text(pair.heading),
      body: text(pair.body),
      mono: text(pair.mono),
      pairId: text(pair.id),
    });
  }

  function onLayoutChange() {
    const family = text(state.pageType.family);
    if (family === "") return;
    setTune("layouts", { [family]: ui.tune.layout.select.value });
  }

  // いまの微調整 (なければ混ぜた値) を、操作と値の表示に写す
  function syncTune() {
    const mixed = state.mixed;
    const tune = state.fineTune;
    const enabled = mixed !== null;
    const seed = record(record(mixed).seed);
    const color = record(seed.color);
    const shape = record(seed.shape);
    syncSlider(ui.tune.brandHue, enabled, tune.brandHue, color.brandHue, 210);
    syncSlider(ui.tune.brandChroma, enabled, tune.brandChroma, color.brandChroma, 0.08);
    syncAccent(enabled, tune.accentHue, color.accentHue, 210);
    syncSlider(ui.tune.contrast, enabled, tune.contrast, color.contrast, 1.2);
    syncSlider(ui.tune.radiusPx, enabled, tune.radiusPx, shape.radiusPx, 8);
    syncSlider(ui.tune.spacingScale, enabled, tune.spacingScale, shape.spacingScale, 1);
    syncSelect(ui.tune.shadow, enabled, tune.shadow, shape.shadow, "soft");
    syncSelect(ui.tune.baseMode, enabled, tune.baseMode, seed.baseMode, "light");
    syncFont(enabled, mixed);
    syncLayout(enabled, mixed);
    syncCopy(enabled, mixed);
  }

  function syncSlider(row, enabled, tuned, mixed, fallback) {
    const value = numberOf(tuned, numberOf(mixed, fallback));
    row.input.disabled = !enabled;
    row.input.value = String(value);
    row.value.textContent = row.format(value);
    row.reset.disabled = !enabled || tuned === undefined;
  }

  function syncAccent(enabled, tuned, mixed, fallback) {
    const row = ui.tune.accent;
    const shown = tuned === undefined ? mixed : tuned;
    row.input.disabled = !enabled || shown === null;
    row.input.value = String(typeof shown === "number" ? shown : fallback);
    row.none.checked = shown === null;
    row.none.disabled = !enabled;
    row.value.textContent = shown === null ? "なし" : typeof shown === "number" ? String(Math.round(shown)) : "—";
    row.reset.disabled = !enabled || tuned === undefined;
  }

  function syncSelect(row, enabled, tuned, mixed, fallback) {
    const value = typeof tuned === "string" ? tuned : typeof mixed === "string" && mixed !== "" ? mixed : fallback;
    row.select.disabled = !enabled;
    row.select.value = value;
    row.reset.disabled = !enabled || tuned === undefined;
  }

  function syncFont(enabled, mixed) {
    const row = ui.tune.font;
    const pairs = ctx.fontPairs().map((item) => record(item));
    row.row.hidden = pairs.length === 0;
    const tuned = state.fineTune.font;
    const mixedId = text(record(record(record(mixed).seed).font).pairId);
    const current = tuned === undefined ? mixedId : text(tuned.pairId);
    const options = pairs.map((pair) => ({ value: text(pair.id), label: `${text(pair.heading)} / ${text(pair.body)}` }));
    const known = options.some((option) => option.value === current);
    if (!known) options.unshift({ value: "", label: "(そのまま)" });
    replaceOptions(row.select, options);
    row.select.disabled = !enabled;
    row.select.value = current;
    row.reset.disabled = !enabled || tuned === undefined;
  }

  function syncLayout(enabled, mixed) {
    const row = ui.tune.layout;
    const family = text(state.pageType.family);
    const options = family === "" ? [] : ctx.layoutsOf(family).map((layout) => ({ value: text(layout), label: text(layout) }));
    replaceOptions(row.select, options);
    row.select.disabled = !enabled || family === "";
    const tuned = record(state.fineTune.layouts)[family];
    const mixedLayout = text(record(record(mixed).layouts)[family]);
    const value = typeof tuned === "string" ? tuned : mixedLayout;
    if (options.some((option) => option.value === value)) row.select.value = value;
    row.reset.disabled = !enabled || tuned === undefined;
  }

  function syncCopy(enabled, mixed) {
    const copy = ui.tune.copy;
    const source = copySource(mixed);
    const signature = copySignatureOf(source);
    if (signature !== copySignature) {
      copySignature = signature;
      copy.headline.value = text(source.headline);
      copy.lead.value = text(source.lead);
      copy.cta.value = text(source.cta);
      syncCopyRows(copy, itemsOf(source));
    }
    for (const control of [copy.headline, copy.lead, copy.cta]) control.disabled = !enabled;
    copy.add.disabled = !enabled || copy.rows.length >= MAX_ITEMS;
  }

  function syncCopyRows(copy, items) {
    const count = Math.min(Math.max(items.length, MIN_ITEMS), MAX_ITEMS);
    while (copy.rows.length < count) copy.rows.push(copyItemRow({ title: "", body: "" }, copy));
    copy.rows.length = count;
    items.forEach((item, index) => {
      const row = copy.rows[index];
      if (row === undefined) return;
      row.title.value = text(item.title);
      row.body.value = text(item.body);
    });
    refreshCopyItems(copy);
  }

  const copySource = (mixed) => {
    const tuneCopy = state.fineTune.copy;
    return tuneCopy === undefined ? record(record(mixed).copy) : record(tuneCopy);
  };

  const itemsOf = (copy) => (Array.isArray(copy.items) ? copy.items.map((item) => record(item)) : []);
  const copySignatureOf = (copy) =>
    JSON.stringify([
      text(copy.headline),
      text(copy.lead),
      text(copy.cta),
      itemsOf(copy).map((item) => [text(item.title), text(item.body)]),
    ]);

  // 文章の欄が変わったら、混ぜた文章を下敷きにした fineTune.copy を作る
  function onCopyChange() {
    if (state.mixed === null) return;
    const base = record(record(state.mixed).copy);
    const copy = ui.tune.copy;
    const next = {
      brand: text(base.brand),
      tagline: text(base.tagline),
      headline: valueOr(copy.headline.value.trim(), text(base.headline)),
      lead: valueOr(copy.lead.value.trim(), text(base.lead)),
      cta: valueOr(copy.cta.value.trim(), text(base.cta)),
      items: copy.rows.map((row, index) => ({
        title: valueOr(row.title.value.trim(), text(itemsOf(base)[index]?.title)),
        body: valueOr(row.body.value.trim(), text(itemsOf(base)[index]?.body)),
      })),
    };
    const problem = copyProblemOf(next);
    if (problem !== "") {
      setNote(copy.note, problem, false);
      return;
    }
    setNote(copy.note, "", false);
    copySignature = copySignatureOf(next);
    setTune("copy", next);
  }

  const valueOr = (value, fallback) => (value === "" ? fallback : value);

  function copyProblemOf(copy) {
    if (copy.brand === "" || copy.tagline === "" || copy.headline === "" || copy.lead === "" || copy.cta === "") {
      return "空の欄は混ぜた値のままになります。";
    }
    if (copy.items.some((item) => item.title === "" || item.body === "")) {
      return "項目の見出しと本文を書いてください (空の項目は効きません)。";
    }
    return "";
  }

  // ---------------------------------------------------------------- コントラスト

  function buildContrastSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "contrast";
    section.append(el("h3", null, "コントラスト"));
    const verdict = el("p", "wb-note", "案を出すと、AA の判定が出ます。");
    const detail = el("p", "wb-note");
    section.append(verdict, detail, el("p", "wb-note", "AAA: 判定なし"));
    section.append(el("h4", null, "チェックリスト"));
    const list = el("div", "wb-checks");
    for (const item of CHECKLIST) {
      const box = document.createElement("input");
      box.type = "checkbox";
      const label = el("label", "wb-check", item);
      label.prepend(box);
      list.append(label);
    }
    section.append(list);
    ui.contrast = { verdict, detail };
    return section;
  }

  // /api/render の checks (light・dark ごとの pass/total) と failed から AA の判定を出す (AAA は結果に無い)
  function renderContrast(payload) {
    const checks = record(record(payload).checks);
    const light = checkCounts(checks.light);
    const dark = checkCounts(checks.dark);
    const failed = numberOf(record(payload).failed, 0);
    const ok = failed === 0 && passAll(light) && passAll(dark);
    ui.contrast.verdict.textContent = ok ? "AA 合格" : `AA 不合格 ${String(Math.max(failed, 0))} 件`;
    ui.contrast.verdict.classList.toggle("status-error", !ok);
    ui.contrast.detail.textContent = `ライト ${String(light.pass)}/${String(light.total)} pass ・ ダーク ${String(dark.pass)}/${String(dark.total)} pass`;
  }

  const checkCounts = (value) => ({ pass: numberOf(record(value).pass, 0), total: numberOf(record(value).total, 0) });
  const passAll = (counts) => counts.total > 0 && counts.pass === counts.total;

  // ---------------------------------------------------------------- トークン

  function buildTokensSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "tokens";
    section.append(el("h3", null, "トークン"));
    section.append(el("p", "wb-note", "いまの見た目 (混ぜた値 + 微調整) を、Tailwind・JSON・CSS 変数の 3 形式で書き出します。"));
    const seg = el("div", "seg");
    const buttons = TOKEN_FORMATS.map((format) => {
      const button = el("button", null, format.label);
      button.type = "button";
      button.addEventListener("click", () => {
        tokens.format = format.key;
        syncTokenButtons(buttons);
        void refreshTokens();
      });
      seg.append(button);
      return button;
    });
    const pre = document.createElement("pre");
    pre.className = "wb-tokens";
    const copy = el("button", "btn", "コピー");
    copy.type = "button";
    copy.addEventListener("click", () => {
      void copyTokens();
    });
    const save = el("button", "btn", "保存");
    save.type = "button";
    save.addEventListener("click", () => {
      void saveTokens();
    });
    const row = el("div", "wb-row");
    row.append(copy, save);
    const note = el("p", "wb-note");
    section.append(seg, pre, row, note);
    ui.tokens = { pre, note, buttons };
    syncTokenButtons(buttons);
    return section;
  }

  function syncTokenButtons(buttons) {
    buttons.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(TOKEN_FORMATS[index].key === tokens.format));
    });
  }

  // いまの方向性 (微調整込み) のトークンを読む。同じ id なら読み直さない。
  // 待っている間に見た目 (state.tuned) が変わっていたら、古い応答は出さない・覚えない (null を返す。PBI-010 差し戻し 1)
  async function ensureTokens() {
    const direction = record(state.tuned);
    const id = text(direction.id);
    if (id === "") throw new Error("先に案を出してください");
    if (tokens.id === id && tokens.value !== null) return tokens.value;
    const payload = await requestJson("/api/tokens", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ direction }) });
    if (text(record(state.tuned).id) !== id) return null;
    tokens.id = id;
    tokens.value = record(payload);
    return tokens.value;
  }

  async function refreshTokens() {
    if (tokens.loading) {
      tokens.again = true;
      return;
    }
    tokens.loading = true;
    tokens.again = false;
    try {
      const value = await ensureTokens();
      if (value === null) {
        ui.tokens.pre.textContent = "";
        setNote(ui.tokens.note, TOKENS_STALE, false);
        return;
      }
      ui.tokens.pre.textContent = text(value[tokens.format]);
      setNote(ui.tokens.note, "", false);
    } catch (error) {
      ui.tokens.pre.textContent = "";
      setNote(ui.tokens.note, `トークンを読み込めませんでした: ${errorMessage(error)}`, true);
    } finally {
      tokens.loading = false;
      if (tokens.again) {
        tokens.again = false;
        void refreshTokens();
      }
    }
  }

  // 混ぜ方が変わったら、出しているトークンは古いので消す
  function syncTokensStale() {
    const id = text(record(state.tuned).id);
    if (tokens.value === null || tokens.id === id) return;
    tokens.value = null;
    tokens.id = "";
    ui.tokens.pre.textContent = "";
    setNote(ui.tokens.note, TOKENS_STALE, false);
  }

  async function copyTokens() {
    try {
      const value = await ensureTokens();
      if (value === null) throw new Error(TOKENS_STALE);
      const current = text(value[tokens.format]);
      if (current === "") throw new Error("書き出す内容がありません");
      if (navigator.clipboard === undefined) throw new Error("この画面ではコピーできません");
      await navigator.clipboard.writeText(current);
      setNote(ui.tokens.note, "コピーしました。", false);
    } catch (error) {
      setNote(ui.tokens.note, `コピーできませんでした: ${errorMessage(error)}`, true);
    }
  }

  async function saveTokens() {
    try {
      const value = await ensureTokens();
      if (value === null) throw new Error(TOKENS_STALE);
      const format = TOKEN_FORMATS.find((entry) => entry.key === tokens.format) ?? TOKEN_FORMATS[0];
      downloadBlob(new Blob([text(value[format.key])], { type: "text/plain;charset=utf-8" }), format.file);
      setNote(ui.tokens.note, `${format.file} として保存しました。`, false);
    } catch (error) {
      setNote(ui.tokens.note, `保存できませんでした: ${errorMessage(error)}`, true);
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  return { build, roundChanged, setPoints, setFineTune, onMixed, onRender };
}
