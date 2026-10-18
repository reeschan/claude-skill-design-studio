// 依頼のフォームの表現 (面・動き・動きの見本)。
// 選んだ表現は state.treatment に置き、依頼・骨組みのプレビュー・ページ・保存に効かせる。
// 一覧は GET /api/treatments から読む。読めないときは「指定しない」「なし」だけで動かし、フォームに知らせる。
// 動きの見本はダイアログで選ぶ。左に一覧、右に選んでいる 1 件の動く見本を出す (12 枚を一度に動かさない)。
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
.wb-motion-samples { margin-top: 8px; display: grid; gap: 6px; }
.wb-motion-summary { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.wb-motion-dialog { width: min(980px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); color: var(--fg); }
.wb-motion-dialog::backdrop { background: color-mix(in oklch, var(--bg) 70%, transparent); }
.wb-motion-dialog[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.wb-motion-head, .wb-motion-foot { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; padding: 12px 16px; }
.wb-motion-head { border-bottom: 1px solid var(--line); }
.wb-motion-foot { border-top: 1px solid var(--line); }
.wb-motion-head h3 { margin: 0; font-size: 16px; }
.wb-motion-count { font-size: 13px; color: var(--muted); }
.wb-motion-body { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); min-height: 0; }
.wb-motion-list { margin: 0; padding: 8px; list-style: none; overflow-y: auto; border-right: 1px solid var(--line); }
.wb-motion-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: var(--radius-sm); }
.wb-motion-item[aria-current="true"] { background: var(--accent-soft); color: var(--accent-soft-fg); }
.wb-motion-item input { margin-top: 3px; }
.wb-motion-pick { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.wb-motion-pick strong { display: block; font-size: 13.5px; overflow-wrap: anywhere; }
.wb-motion-pick span { display: block; font-size: 12px; color: var(--muted); }
.wb-motion-stage { display: grid; gap: 8px; align-content: start; min-width: 0; padding: 12px 16px; overflow-y: auto; }
.wb-motion-stage h4 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.wb-motion-stage p { margin: 0; }
.wb-motion-frame { display: block; width: 100%; height: clamp(220px, 48vh, 420px); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
@media (max-width: 720px) {
  .wb-motion-body { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }
  .wb-motion-list { height: 34vh; min-height: 160px; border-right: 0; border-bottom: 1px solid var(--line); }
  .wb-motion-stage { overflow: visible; }
}
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
  const ui = { surface: null, surfaceNote: null, motion: null, motionNote: null, samplesBox: null, summary: null, note: null };
  const dialog = { root: null, list: null, count: null, stage: null };
  // 読み込めた一覧。null の間 (読み込み前・失敗) は「指定しない」「なし」だけを出す
  let listing = null;
  // ダイアログで見ている見本の id と、読み込んだ見本の HTML (開き直しで読み直さない)
  let currentSample = "";
  let previewToken = 0;
  const previewCache = new Map();

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

  // ---------------------------------------------------------------- 動きの見本 (フォームの中)

  // フォームには選んだ見本の名前と、ダイアログを開くボタンだけを置く
  function buildSamplesBox() {
    const box = el("div", "wb-group wb-motion-samples");
    box.hidden = true;
    const summary = el("p", "wb-motion-summary");
    const open = el("button", "btn", "動きの見本を選ぶ…");
    open.type = "button";
    open.addEventListener("click", openDialog);
    box.append(el("span", "wb-caption", `動きの見本 (${String(SAMPLE_MAX)} 件まで)`), summary, open);
    ui.samplesBox = box;
    ui.summary = summary;
    return box;
  }

  function motionSamples() {
    return listing === null ? [] : entriesOf(listing.motions, "id");
  }

  function sampleName(id) {
    const sample = motionSamples().find((item) => text(item.id) === id);
    return sample === undefined ? id : text(sample.name);
  }

  function renderSamples() {
    const box = ui.samplesBox;
    if (box === null) return;
    box.hidden = state.treatment.motion !== "animated";
    renderSummary();
    if (dialog.root !== null && dialog.root.open) renderDialogList();
  }

  function renderSummary() {
    const summary = ui.summary;
    if (summary === null) return;
    const chosen = state.treatment.motionSamples;
    if (listing === null) summary.textContent = "一覧を読み込めないため、見本は選べません。";
    else if (chosen.length === 0) summary.textContent = "まだ選んでいません。選ばなければ、LLM が見本の中から選びます。";
    else summary.textContent = `選んだ見本 (${String(chosen.length)}/${String(SAMPLE_MAX)}): ${chosen.map(sampleName).join("・")}`;
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
    renderSummary();
    renderDialogList();
    schedulePreview();
  }

  // ---------------------------------------------------------------- 動きの見本 (ダイアログ)

  function ensureDialog() {
    if (dialog.root !== null) return dialog.root;
    const root = document.createElement("dialog");
    root.className = "wb-motion-dialog";
    root.setAttribute("aria-labelledby", "wb-motion-title");
    const title = el("h3", null, "動きの見本を選ぶ");
    title.id = "wb-motion-title";
    const count = el("span", "wb-motion-count");
    const head = el("div", "wb-motion-head");
    head.append(title, count);
    const list = el("ul", "wb-motion-list");
    list.setAttribute("aria-label", "動きの見本の一覧");
    const stage = el("section", "wb-motion-stage");
    stage.setAttribute("aria-live", "polite");
    const body = el("div", "wb-motion-body");
    body.append(list, stage);
    root.append(head, body, buildDialogFoot(root));
    // Esc で閉じたときも見本を止める (close が届かないブラウザがあるため cancel でも止める)
    root.addEventListener("cancel", stopPreview);
    root.addEventListener("close", stopPreview);
    document.body.append(root);
    Object.assign(dialog, { root, list, count, stage });
    return root;
  }

  function buildDialogFoot(root) {
    const done = el("button", "btn btn-primary", "決める");
    done.type = "button";
    done.addEventListener("click", () => {
      root.close();
      stopPreview();
    });
    const foot = el("div", "wb-motion-foot");
    foot.append(el("p", "wb-note", "名前を押すと、その見本が動きます。使うものにチェックを付けてください (4 件まで)。"), done);
    return foot;
  }

  function openDialog() {
    const root = ensureDialog();
    const samples = motionSamples();
    const first = state.treatment.motionSamples[0] ?? (samples.length > 0 ? text(samples[0].id) : "");
    currentSample = first;
    renderDialogList();
    root.showModal();
    void showSamplePreview(first);
  }

  function renderDialogList() {
    if (dialog.list === null || dialog.count === null) return;
    const samples = motionSamples();
    dialog.list.replaceChildren(...samples.map(dialogItemOf));
    const chosen = state.treatment.motionSamples.length;
    dialog.count.textContent = `${String(chosen)}/${String(SAMPLE_MAX)} 件を選択中`;
  }

  function dialogItemOf(raw) {
    const sample = record(raw);
    const id = text(sample.id);
    const chosen = state.treatment.motionSamples.includes(id);
    const item = el("li", "wb-motion-item");
    item.setAttribute("aria-current", String(id === currentSample));
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = chosen;
    check.disabled = !chosen && state.treatment.motionSamples.length >= SAMPLE_MAX;
    check.setAttribute("aria-label", `${text(sample.name)} を使う`);
    check.addEventListener("change", () => {
      toggleSample(id, check.checked);
    });
    const pick = el("button", "wb-motion-pick");
    pick.type = "button";
    pick.append(el("strong", null, text(sample.name)), el("span", null, usesText(sample.uses)));
    pick.addEventListener("click", () => {
      void showSamplePreview(id);
    });
    item.append(check, pick);
    return item;
  }

  function usesText(value) {
    if (!Array.isArray(value)) return "";
    return value
      .map((item) => text(item))
      .filter((item) => item !== "")
      .join("・");
  }

  // 右に見本 1 件の説明と動く見本を出す。sandbox の iframe に src で読ませると描かれないブラウザ
  // (Claude のブラウザのペイン) があるため、骨組みのプレビューと同じく HTML を読んで srcdoc に入れる
  async function showSamplePreview(id) {
    const stage = dialog.stage;
    if (stage === null) return;
    currentSample = id;
    renderDialogList();
    const sample = record(motionSamples().find((item) => text(item.id) === id));
    stage.replaceChildren(...sampleDetailsOf(sample));
    if (id === "") return;
    previewToken += 1;
    const token = previewToken;
    try {
      const html = previewCache.get(id) ?? (await fetchSampleHtml(`/api/motions/${encodeURIComponent(id)}/preview`));
      previewCache.set(id, html);
      if (token !== previewToken) return; // あとから別の見本を選んだ
      const frame = document.createElement("iframe");
      frame.className = "wb-motion-frame";
      frame.title = `${text(sample.name)} の動きの見本`;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.srcdoc = html;
      stage.append(frame);
    } catch (error) {
      if (token === previewToken) stage.append(el("p", "wb-note", errorMessage(error)));
    }
  }

  async function fetchSampleHtml(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`見本を読み込めませんでした (${String(response.status)})`);
    return response.text();
  }

  function sampleDetailsOf(sample) {
    if (text(sample.id) === "") return [el("p", "wb-note", "見本がありません。")];
    const nodes = [el("h4", null, text(sample.name))];
    const uses = usesText(sample.uses);
    if (uses !== "") nodes.push(el("p", "wb-note", `使いどころ: ${uses}`));
    const description = text(sample.description);
    if (description !== "") nodes.push(el("p", null, description));
    return nodes;
  }

  // ダイアログを閉じたら見本を止める (動く iframe を残さない)
  function stopPreview() {
    previewToken += 1;
    if (dialog.stage !== null) dialog.stage.replaceChildren();
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
