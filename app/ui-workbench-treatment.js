// 依頼のフォームの表現 (面・動き・動きの見本)。
// 選んだ表現は state.treatment に置き、依頼・骨組みのプレビュー・ページ・保存に効かせる。
// 一覧は GET /api/treatments から読む。読めないときは「指定しない」「なし」だけで動かし、フォームに知らせる。
// 動きの見本の iframe は「動きを見る」を押したときだけ作る (12 枚を一度に動かさない)。
// 状態を変える処理と DOM を作る処理を分け、状態・API・描き直しは呼び出し元 (ui-workbench.js) から受け取る。
const SAMPLE_MAX = 4;
const SURFACE_FALLBACK = { id: "none", name: "指定しない", description: "面を指定しません。" };
const MOTION_OPTIONS = [
  { value: "none", label: "なし", description: "動かしません。フォーカスの表示だけにします。" },
  { value: "subtle", label: "控えめ", description: "ホバー・押下・開閉の短い動きだけにします。" },
  { value: "animated", label: "Animated", description: "動きの見本から選んで、ページの主役にします。" },
];
const TREATMENT_CSS = `
.wb-treatment-desc { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
.wb-motion-samples { margin-top: 8px; }
.wb-motion-list { display: grid; gap: 8px; margin: 6px 0 0; padding: 0; list-style: none; }
.wb-motion { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.wb-motion h4 { margin: 0; font-size: 13.5px; overflow-wrap: anywhere; }
.wb-motion p { margin: 0; }
.wb-motion-frame { width: 100%; height: 200px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
`;

// 一覧の値を配列にする (読めなかった項目は捨て、id のあるものだけ使う)
function entriesOf(value, key) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item !== null && typeof item === "object" ? item : {}))
    .filter((item) => typeof item[key] === "string" && item[key] !== "");
}

export function createTreatmentPanel(ctx) {
  const { el, text, record, errorMessage, requestJson, setNote, state, fieldOf, schedulePreview } = ctx;
  const ui = { surface: null, surfaceNote: null, motion: null, motionNote: null, samplesBox: null, samples: null, note: null };
  // 読み込めた一覧。null の間 (読み込み前・失敗) は「指定しない」「なし」だけを出す
  let listing = null;

  function build(root) {
    injectStyles();
    root.append(buildSurfaceField(), buildMotionField(), buildSamplesBox(), buildNote());
    renderSurfaces();
    renderMotions();
    renderSamples();
    void loadListing();
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = TREATMENT_CSS;
    document.head.append(style);
  }

  // ---------------------------------------------------------------- 面

  function buildSurfaceField() {
    const select = document.createElement("select");
    select.className = "wb-input";
    select.addEventListener("change", () => {
      state.treatment.surface = select.value;
      renderSurfaceDescription();
      schedulePreview();
    });
    const field = fieldOf("表現の面", select);
    const note = el("p", "wb-treatment-desc");
    field.append(note);
    ui.surface = select;
    ui.surfaceNote = note;
    return field;
  }

  function surfaceEntries() {
    const entries = listing === null ? [] : entriesOf(listing.surfaces, "id");
    return entries.length === 0 ? [SURFACE_FALLBACK] : entries;
  }

  function renderSurfaces() {
    const select = ui.surface;
    if (select === null) return;
    const entries = surfaceEntries();
    const current = state.treatment.surface;
    select.replaceChildren(...entries.map(surfaceOptionOf));
    // 開き直した値が一覧に無いときも、選び直すまではその値を出しておく
    if (!entries.some((entry) => text(entry.id) === current) && current !== "")
      select.append(surfaceOptionOf({ id: current, name: current }));
    select.value = current;
    renderSurfaceDescription();
  }

  function surfaceOptionOf(entry) {
    const option = document.createElement("option");
    option.value = text(entry.id);
    option.textContent = text(entry.name) === "" ? text(entry.id) : text(entry.name);
    return option;
  }

  function renderSurfaceDescription() {
    const note = ui.surfaceNote;
    if (note === null) return;
    const entry = surfaceEntries().find((item) => text(item.id) === state.treatment.surface);
    note.textContent = entry === undefined ? "" : text(entry.description);
  }

  // ---------------------------------------------------------------- 動き

  function buildMotionField() {
    const select = document.createElement("select");
    select.className = "wb-input";
    select.addEventListener("change", () => {
      state.treatment.motion = select.value;
      if (state.treatment.motion !== "animated") state.treatment.motionSamples = [];
      renderMotionDescription();
      renderSamples();
      schedulePreview();
    });
    const field = fieldOf("表現の動き", select);
    const note = el("p", "wb-treatment-desc");
    field.append(note);
    ui.motion = select;
    ui.motionNote = note;
    return field;
  }

  // 動きの選択。一覧が読めないときは「なし」だけにする
  function motionOptions() {
    return listing === null ? MOTION_OPTIONS.filter((option) => option.value === "none") : MOTION_OPTIONS;
  }

  function renderMotions() {
    const select = ui.motion;
    if (select === null) return;
    const options = motionOptions();
    const current = state.treatment.motion;
    select.replaceChildren(...options.map(motionOptionOf));
    if (!options.some((option) => option.value === current)) {
      const known = MOTION_OPTIONS.find((option) => option.value === current);
      if (known !== undefined) select.append(motionOptionOf(known));
    }
    select.value = current;
    renderMotionDescription();
  }

  function motionOptionOf(option) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    return node;
  }

  function renderMotionDescription() {
    const note = ui.motionNote;
    if (note === null) return;
    const option = MOTION_OPTIONS.find((item) => item.value === state.treatment.motion);
    note.textContent = option === undefined ? "" : option.description;
  }

  // ---------------------------------------------------------------- 動きの見本

  function buildSamplesBox() {
    const box = el("div", "wb-group wb-motion-samples");
    box.hidden = true;
    box.append(
      el("span", "wb-caption", `動きの見本 (${String(SAMPLE_MAX)} 件まで)`),
      el("p", "wb-note", "使うものにチェックを付けてください。「動きを見る」を押すと、その見本だけを動かします。"),
    );
    const list = el("ul", "wb-motion-list");
    box.append(list);
    ui.samplesBox = box;
    ui.samples = list;
    return box;
  }

  function motionSamples() {
    return listing === null ? [] : entriesOf(listing.motions, "id");
  }

  function renderSamples() {
    const box = ui.samplesBox;
    const list = ui.samples;
    if (box === null || list === null) return;
    box.hidden = state.treatment.motion !== "animated";
    if (box.hidden) return;
    const samples = motionSamples();
    list.replaceChildren(...samples.map(sampleItemOf));
    if (samples.length === 0) {
      list.append(el("li", "wb-note", listing === null ? "一覧を読み込めないため、見本は選べません。" : "見本がありません。"));
    }
    syncSampleChecks();
  }

  function sampleItemOf(raw) {
    const sample = record(raw);
    const id = text(sample.id);
    const item = el("li", "wb-motion");
    item.dataset.sample = id;
    item.append(el("h4", null, text(sample.name)));
    const uses = usesText(sample.uses);
    if (uses !== "") item.append(el("p", "wb-note", `使いどころ: ${uses}`));
    const description = text(sample.description);
    if (description !== "") item.append(el("p", "wb-note", description));
    item.append(sampleToolsOf(item, sample));
    return item;
  }

  function usesText(value) {
    if (!Array.isArray(value)) return "";
    return value
      .map((item) => text(item))
      .filter((item) => item !== "")
      .join("・");
  }

  function sampleToolsOf(item, sample) {
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = state.treatment.motionSamples.includes(text(sample.id));
    check.addEventListener("change", () => {
      toggleSample(text(sample.id), check.checked);
    });
    const label = el("label", "wb-check", "この動きを使う");
    label.prepend(check);
    const watch = el("button", "btn", "動きを見る");
    watch.type = "button";
    watch.addEventListener("click", () => {
      toggleSamplePreview(item, sample);
    });
    const tools = el("div", "wb-row");
    tools.append(label, watch);
    return tools;
  }

  // 4 件まで。5 件目は選べない (チェックを止める)
  function toggleSample(id, checked) {
    const samples = state.treatment.motionSamples;
    if (checked) {
      if (!samples.includes(id) && samples.length < SAMPLE_MAX) samples.push(id);
    } else {
      const at = samples.indexOf(id);
      if (at >= 0) samples.splice(at, 1);
    }
    syncSampleChecks();
    schedulePreview();
  }

  function syncSampleChecks() {
    const list = ui.samples;
    if (list === null) return;
    for (const item of list.querySelectorAll("li[data-sample]")) {
      const check = item.querySelector('input[type="checkbox"]');
      if (check === null) continue;
      const checked = state.treatment.motionSamples.includes(item.dataset.sample ?? "");
      check.checked = checked;
      check.disabled = !checked && state.treatment.motionSamples.length >= SAMPLE_MAX;
    }
  }

  // 「動きを見る」で、その見本の iframe を作る。もう一度押したら閉じる
  function toggleSamplePreview(item, sample) {
    const existing = item.querySelector("iframe");
    if (existing !== null) {
      existing.remove();
      return;
    }
    const frame = document.createElement("iframe");
    frame.className = "wb-motion-frame";
    frame.title = `${text(sample.name)} の動きの見本`;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = `/api/motions/${encodeURIComponent(text(sample.id))}/preview`;
    item.append(frame);
  }

  // ---------------------------------------------------------------- 一覧の読み込み

  function buildNote() {
    ui.note = el("p", "wb-note");
    return ui.note;
  }

  async function loadListing() {
    try {
      const payload = record(await requestJson("/api/treatments"));
      listing = { surfaces: entriesOf(payload.surfaces, "id"), motions: entriesOf(payload.motions, "id") };
    } catch (error) {
      listing = null;
      setNote(
        ui.note,
        `面と動きの一覧を読み込めませんでした: ${errorMessage(error)}。面は「指定しない」、動きは「なし」だけ選べます。`,
        true,
      );
    }
    renderSurfaces();
    renderMotions();
    renderSamples();
  }

  // 開き直したプロジェクトの表現を画面に戻す
  function setTreatment(treatment) {
    const value = record(treatment);
    state.treatment = {
      surface: text(value.surface) === "" ? "none" : text(value.surface),
      motion: text(value.motion) === "" ? "none" : text(value.motion),
      motionSamples: Array.isArray(value.motionSamples) ? value.motionSamples.map((id) => text(id)).filter((id) => id !== "") : [],
    };
    renderSurfaces();
    renderMotions();
    renderSamples();
  }

  return { build, setTreatment };
}
