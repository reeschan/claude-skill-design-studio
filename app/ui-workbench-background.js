// 背景スケッチの部品 (作業台の右の列)。式は sandbox="allow-scripts" だけの iframe の中の Worker で動かし、
// 焼き込んだ WebP の data URL を current().image として返す。組み込み (プレビュー・保存・開き直し) は
// ui-workbench.js が行う。状態を変える処理と DOM を作る処理を分け、状態・API・描き直しは呼び出し元から受け取る。
const BAKE_DEBOUNCE_MS = 500;
const SKETCH_CODE_MAX = 8000;
const LIVE_WIDTH = 480;
const LIVE_HEIGHT = 270;

const SOURCE_OPTIONS = [
  { value: "sample", label: "見本" },
  { value: "paste", label: "貼る" },
  { value: "llm", label: "LLM に任せる" },
];
const PLACEMENT_OPTIONS = [
  { value: "hero", label: "ヒーローだけ" },
  { value: "page", label: "ページ全体" },
];
const MOTION_OPTIONS = [
  { value: "still", label: "止める" },
  { value: "slow", label: "ゆっくり動かす" },
];
const SOURCE_VALUES = SOURCE_OPTIONS.map((option) => option.value);
const PLACEMENT_VALUES = PLACEMENT_OPTIONS.map((option) => option.value);
const MOTION_VALUES = MOTION_OPTIONS.map((option) => option.value);

// iframe の中身。スクリプトは src で読む (インラインにしない)。canvas は 16:9
const HOST_SRCDOC = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}canvas{display:block;width:100%;height:100%}</style><canvas width="${String(LIVE_WIDTH)}" height="${String(LIVE_HEIGHT)}"></canvas><script src="${location.origin}/app/sketch-host.js"></script>`;

const BACKGROUND_CSS = `
.wb-sketch-code { min-height: 120px; font-family: var(--font-mono); font-size: 12px; }
.wb-sketch-frame { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #000; }
.wb-sketch-reason { margin: 0; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
`;

export function createBackgroundPanel(ctx) {
  const {
    el,
    text,
    record,
    numberOf,
    errorMessage,
    requestJson,
    requestText,
    setNote,
    fieldOf,
    state,
    JSON_HEADERS,
    onBackgroundChange,
    collectBrief,
  } = ctx;
  // 付けるかどうか・入手先・式・当てる場所・動き・焼き込んだ画像・テーマの色
  const model = {
    enabled: false,
    source: "sample",
    sampleId: null,
    code: "",
    placement: "hero",
    motion: "still",
    image: null,
    palette: null,
  };
  const ui = {
    toggle: null,
    sourceInputs: [],
    sample: null,
    sampleField: null,
    sampleNote: null,
    code: null,
    llm: null,
    llmField: null,
    placementInputs: [],
    motionInputs: [],
    frame: null,
    reason: null,
  };
  // host は iframe のスクリプト。init を 1 回だけ送る
  const host = { engine: null, initialized: false };
  let samples = [];
  let workTimer = null;
  let bakeToken = 0;
  let pendingBake = null;
  let llmBusy = false;
  // LLM の応答の世代。待っている間に式を変えた・外したら古い応答は捨てる
  let llmSession = 0;

  function build(root) {
    injectStyles();
    // iframe の script は document の読み込みより先に「用意できた」を知らせるので、先に受ける
    window.addEventListener("message", onHostMessage);
    root.append(
      buildToggle(),
      buildSourceField(),
      buildSampleField(),
      buildCodeField(),
      buildLlmField(),
      buildPlacementField(),
      buildMotionField(),
      buildPreview(),
      buildReason(),
    );
    syncControls();
    void loadSamples();
    void loadEngine();
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = BACKGROUND_CSS;
    document.head.append(style);
  }

  // ---------------------------------------------------------------- 画面

  function buildToggle() {
    const label = el("label", "wb-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", onToggle);
    label.append(input, el("span", null, "背景スケッチを付ける"));
    ui.toggle = input;
    return label;
  }

  function buildSourceField() {
    const group = radioGroup("入手先", "wb-background-source", SOURCE_OPTIONS, onSourceChange);
    ui.sourceInputs = group.inputs;
    return group.field;
  }

  function buildPlacementField() {
    const group = radioGroup("当てる場所", "wb-background-placement", PLACEMENT_OPTIONS, onPlacementChange);
    ui.placementInputs = group.inputs;
    return group.field;
  }

  function buildMotionField() {
    const group = radioGroup("動き", "wb-background-motion", MOTION_OPTIONS, onMotionChange);
    ui.motionInputs = group.inputs;
    return group.field;
  }

  function radioGroup(caption, name, options, onPick) {
    const field = el("div", "wb-group");
    field.append(el("span", "wb-caption", caption));
    const list = el("div", "wb-checks");
    const inputs = options.map((option) => radioOf(name, option, onPick, list));
    field.append(list);
    return { field, inputs };
  }

  function radioOf(name, option, onPick, list) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;
    input.addEventListener("change", () => {
      if (input.checked) onPick(option.value);
    });
    const label = el("label", "wb-check");
    label.append(input, el("span", null, option.label));
    list.append(label);
    return input;
  }

  function buildSampleField() {
    const select = document.createElement("select");
    select.className = "wb-input";
    select.addEventListener("change", onSampleChange);
    const note = el("p", "wb-note");
    const field = fieldOf("見本", select);
    field.append(note);
    ui.sample = select;
    ui.sampleNote = note;
    ui.sampleField = field;
    return field;
  }

  function buildCodeField() {
    const area = document.createElement("textarea");
    area.className = "wb-input wb-sketch-code";
    area.rows = 8;
    area.maxLength = SKETCH_CODE_MAX;
    area.spellcheck = false;
    area.addEventListener("input", onCodeInput);
    ui.code = area;
    return fieldOf("式 (Sketch のコード)", area);
  }

  function buildLlmField() {
    const box = el("div", "wb-group");
    const button = el("button", "btn", "LLM に作らせる");
    button.type = "button";
    button.addEventListener("click", () => {
      void generateWithLlm();
    });
    box.append(button, el("p", "wb-note", "いまの方向性と依頼から式を作ります。"));
    ui.llm = button;
    ui.llmField = box;
    return box;
  }

  function buildPreview() {
    const box = el("div", "wb-group");
    const frame = document.createElement("iframe");
    frame.className = "wb-sketch-frame";
    frame.title = "背景スケッチのプレビュー";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.addEventListener("load", onFrameLoad);
    frame.srcdoc = HOST_SRCDOC;
    box.append(el("span", "wb-caption", "小さなプレビュー"), frame);
    ui.frame = frame;
    return box;
  }

  function buildReason() {
    const note = el("p", "wb-sketch-reason");
    ui.reason = note;
    return note;
  }

  function syncControls() {
    if (ui.toggle !== null) ui.toggle.checked = model.enabled;
    syncOptionInputs(ui.sourceInputs, model.source);
    syncOptionInputs(ui.placementInputs, model.placement);
    syncOptionInputs(ui.motionInputs, model.motion);
    if (ui.code !== null) ui.code.value = model.code;
    renderSourceFields();
    renderSampleOptions();
  }

  function syncOptionInputs(inputs, value) {
    for (const input of inputs) input.checked = input.value === value;
  }

  function renderSourceFields() {
    if (ui.sampleField !== null) ui.sampleField.hidden = model.source !== "sample";
    if (ui.llmField !== null) ui.llmField.hidden = model.source !== "llm";
  }

  // ---------------------------------------------------------------- 操作

  function onToggle() {
    if (ui.toggle === null) return;
    model.enabled = ui.toggle.checked;
    if (!model.enabled) {
      llmSession += 1;
      clearWork();
      stopHost();
      model.image = null;
      clearReason();
      onBackgroundChange();
      return;
    }
    fillFirstSample();
    scheduleWork();
  }

  function onSourceChange(value) {
    model.source = value;
    renderSourceFields();
    fillFirstSample();
  }

  // 式がまだ無いときに、見本の 1 件目を入れておく
  function fillFirstSample() {
    if (model.code !== "" || model.source !== "sample" || samples.length === 0) return;
    pickSample(text(samples[0].id));
  }

  function onSampleChange() {
    if (ui.sample === null) return;
    pickSample(ui.sample.value);
  }

  function pickSample(id) {
    const sample = samples.find((item) => text(item.id) === id);
    if (sample === undefined) return;
    llmSession += 1;
    model.source = "sample";
    model.sampleId = id;
    setCode(text(sample.code));
    syncControls();
    scheduleWork();
  }

  function onCodeInput() {
    if (ui.code === null) return;
    llmSession += 1;
    model.code = ui.code.value;
    model.source = "paste";
    model.sampleId = null;
    syncOptionInputs(ui.sourceInputs, model.source);
    renderSourceFields();
    scheduleWork();
  }

  // 当てる場所・動きだけの変化は焼き直さず、知らせるだけ
  function onPlacementChange(value) {
    model.placement = value;
    onBackgroundChange();
  }

  function onMotionChange(value) {
    model.motion = value;
    onBackgroundChange();
  }

  function setCode(code) {
    model.code = code;
    if (ui.code !== null) ui.code.value = code;
  }

  function clearReason() {
    setNote(ui.reason, "", false);
  }

  // ---------------------------------------------------------------- 見本とエンジン

  async function loadSamples() {
    try {
      const payload = record(await requestJson("/api/sketches"));
      samples = entriesOf(payload.sketches);
    } catch (error) {
      samples = [];
      setNote(ui.reason, `見本を読み込めませんでした: ${errorMessage(error)}`, true);
    }
    renderSampleOptions();
  }

  function entriesOf(value) {
    if (!Array.isArray(value)) return [];
    return value.map(record).filter((item) => text(item.id) !== "" && text(item.code) !== "");
  }

  function renderSampleOptions() {
    const select = ui.sample;
    if (select === null) return;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "見本を選んでください";
    const extras =
      model.sampleId !== null && !samples.some((item) => text(item.id) === model.sampleId)
        ? [sampleOptionOf({ id: model.sampleId, name: model.sampleId })]
        : [];
    select.replaceChildren(placeholder, ...samples.map(sampleOptionOf), ...extras);
    select.value = model.sampleId ?? "";
    renderSampleDescription();
  }

  function sampleOptionOf(sample) {
    const option = document.createElement("option");
    option.value = text(sample.id);
    option.textContent = text(sample.name) === "" ? text(sample.id) : text(sample.name);
    return option;
  }

  function renderSampleDescription() {
    const note = ui.sampleNote;
    if (note === null) return;
    const sample = samples.find((item) => text(item.id) === model.sampleId);
    note.textContent = sample === undefined ? "" : text(sample.description);
  }

  async function loadEngine() {
    try {
      host.engine = text(await requestText("/app/sketch-engine.js"));
    } catch (error) {
      setNote(ui.reason, `スケッチのエンジンを読み込めませんでした: ${errorMessage(error)}`, true);
      return;
    }
    sendInit();
  }

  function sendInit() {
    if (host.initialized || host.engine === null || host.engine === "") return;
    host.initialized = true;
    postToHost({ type: "init", engine: host.engine });
    scheduleWork();
  }

  // iframe は DOM から外して付け直すと読み直される。新しい host は engine を持たないので、
  // initialized を戻して init を送り直す (送らないと次の run・bake が空の Worker になる)
  function onFrameLoad() {
    host.initialized = false;
    sendInit();
  }

  // ---------------------------------------------------------------- host とのやり取り

  function postToHost(message) {
    const target = ui.frame === null ? null : ui.frame.contentWindow;
    if (target === null) return;
    target.postMessage(message, "*");
  }

  function stopHost() {
    postToHost({ type: "stop" });
  }

  function onHostMessage(event) {
    const frame = ui.frame;
    if (frame === null || event.source !== frame.contentWindow) return;
    const message = record(event.data);
    if (message.type === "ready") {
      // 読み直された host からも ready が来る。init を送り直さないと engine が空のまま
      host.initialized = false;
      sendInit();
    } else if (message.type === "baked") onBaked(message);
    else if (message.type === "error") onHostError(message);
  }

  function onBaked(message) {
    if (numberOf(message.token, -1) !== bakeToken || pendingBake === null) return;
    const resolve = pendingBake.resolve;
    pendingBake = null;
    resolve({ ok: true, image: text(message.image) });
  }

  function onHostError(message) {
    const reason = reasonOf(message);
    setNote(ui.reason, reason, true);
    if (numberOf(message.token, -1) !== bakeToken || pendingBake === null) return;
    const resolve = pendingBake.resolve;
    pendingBake = null;
    model.image = null;
    resolve({ ok: false, error: reason });
    onBackgroundChange();
  }

  function reasonOf(message) {
    const kind = text(message.kind);
    if (kind === "unknown-name") return `使えない関数: ${text(message.name)}`;
    if (kind === "timeout") return "時間切れ (1 フレームが 2 秒を超えました)";
    if (kind === "syntax") return "構文の誤り";
    return `エラー: ${text(message.message)}`;
  }

  // ---------------------------------------------------------------- 焼き込み

  function scheduleWork() {
    clearWork();
    if (!model.enabled) return;
    workTimer = setTimeout(runWork, BAKE_DEBOUNCE_MS);
  }

  function clearWork() {
    if (workTimer === null) return;
    clearTimeout(workTimer);
    workTimer = null;
  }

  function runWork() {
    workTimer = null;
    if (!model.enabled || model.code === "" || !host.initialized) return;
    postToHost({ type: "run", code: model.code, width: LIVE_WIDTH, height: LIVE_HEIGHT, palette: model.palette });
    if (model.palette === null) return;
    void bakeNow(model.code).then(applyBake);
  }

  // 焼き込みを依頼する。新しい依頼が来たら前の依頼は cancelled で返す (古い応答は使わない)
  function bakeNow(code) {
    bakeToken += 1;
    const token = bakeToken;
    const previous = pendingBake;
    return new Promise((resolve) => {
      pendingBake = { token, resolve };
      if (previous !== null) previous.resolve({ ok: false, cancelled: true });
      postToHost({ type: "bake", code, palette: model.palette, token });
    });
  }

  function applyBake(result) {
    if (result.ok !== true) return;
    model.image = result.image;
    clearReason();
    onBackgroundChange();
  }

  // ---------------------------------------------------------------- LLM

  async function generateWithLlm() {
    if (llmBusy) return;
    llmBusy = true;
    llmSession += 1;
    const session = llmSession;
    setLlmDisabled(true);
    setNote(ui.reason, "LLM に作らせています…", false);
    try {
      const direction = record(state.tuned);
      const brief = collectBrief();
      const first = await askSketch({ direction, brief });
      if (session !== llmSession || first.cancelled === true) return;
      const second = first.ok ? first : await askSketch({ direction, brief, previous: { code: first.code, error: first.error } });
      if (session !== llmSession) return;
      if (second.ok) {
        applyLlm(second);
        return;
      }
      if (second.cancelled === true) return;
      setNote(ui.reason, "LLM の式は動きませんでした。見本から選んでください", true);
    } catch (error) {
      setNote(ui.reason, `LLM に作らせられませんでした: ${errorMessage(error)}`, true);
    } finally {
      llmBusy = false;
      setLlmDisabled(false);
    }
  }

  function setLlmDisabled(disabled) {
    if (ui.llm !== null) ui.llm.disabled = disabled;
  }

  async function askSketch(input) {
    if (!host.initialized) throw new Error("スケッチのエンジンを読み込んでいます。少し待ってから試してください");
    const body = { direction: input.direction, brief: input.brief, previous: input.previous };
    const payload = record(await requestJson("/api/sketch", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }));
    const code = text(payload.code);
    if (code === "") return { ok: false, code: "", error: "LLM の式が空でした" };
    const trial = await bakeNow(code);
    if (trial.cancelled === true) return { ok: false, cancelled: true };
    if (trial.ok !== true) return { ok: false, code, error: trial.error ?? "試した式が動きませんでした" };
    return { ok: true, code, image: trial.image };
  }

  function applyLlm(result) {
    model.enabled = true;
    model.source = "llm";
    model.sampleId = null;
    setCode(result.code);
    model.image = result.image;
    syncControls();
    clearReason();
    onBackgroundChange();
    postToHost({ type: "run", code: model.code, width: LIVE_WIDTH, height: LIVE_HEIGHT, palette: model.palette });
  }

  // ---------------------------------------------------------------- 外から受ける

  // 開き直したプロジェクトの背景を戻す (null なら外した状態)
  function setBackground(background) {
    const value = record(background);
    const attached = background !== null && typeof background === "object" && text(value.code) !== "";
    llmSession += 1;
    model.enabled = attached;
    model.source = oneOf(value.source, SOURCE_VALUES, "sample");
    model.sampleId = model.source === "sample" && text(value.sampleId) !== "" ? text(value.sampleId) : null;
    model.code = attached ? text(value.code) : "";
    model.placement = oneOf(value.placement, PLACEMENT_VALUES, "hero");
    model.motion = oneOf(value.motion, MOTION_VALUES, "still");
    model.image = null;
    clearWork();
    syncControls();
    clearReason();
    stopHost();
    if (!attached) {
      onBackgroundChange();
      return;
    }
    scheduleWork();
  }

  // テーマの色。まだ無ければ焼かない (setPalette が来たら焼く)
  function setPalette(palette) {
    model.palette = paletteOf(palette);
    if (model.enabled) scheduleWork();
  }

  function paletteOf(value) {
    const palette = record(value);
    const background = rgbOf(palette.background);
    const primary = rgbOf(palette.primary);
    const accent = rgbOf(palette.accent);
    if (background === null || primary === null || accent === null) return null;
    return { background, primary, accent };
  }

  function rgbOf(value) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const rgb = value.slice(0, 3).map((item) => Math.round(Number(item)));
    return rgb.every((item) => Number.isFinite(item)) ? rgb : null;
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function current() {
    if (!model.enabled || model.code === "") return { sketch: null, image: null };
    const sketch = {
      source: model.source,
      sampleId: model.source === "sample" ? model.sampleId : null,
      code: model.code,
      placement: model.placement,
      motion: model.motion,
    };
    return { sketch, image: model.image };
  }

  return { build, setBackground, setPalette, current };
}
