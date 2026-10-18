// 作業台の右の列の後半 (作るもの・保存)。ページ・部品帳・部品・デザインガイドを作って中央のプレビューに出し、
// プロジェクトとして保存・開き直す。デザインガイドは部品帳の HTML と文書 (design-guide.md・style-guide.md) を持つ。
// LLM が作ったものは sandbox="allow-scripts" の iframe に包んで別タブで開く (アプリの API に届かないように)。
// 作るものの生成と保存は、案の世代 (state.session) を進めない。進めると、出している途中の案や作ったものの応答が
// 知らせなしに捨てられる (生成は数分かかる)。連打は busy の印で防ぐ。
// 状態を変える処理と DOM を作る処理を分け、状態・API・描き直しは呼び出し元 (ui-workbench.js) から受け取る。
const PAGE_CSS = `
.wb-pages { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.wb-page-entry button[aria-pressed="true"] { border-color: transparent; background: var(--accent-soft); color: var(--accent-soft-fg); font-weight: 700; }
.wb-projects { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wb-project { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.wb-project p { margin: 0; }
.wb-project-info { min-width: 0; }
.wb-project-name { font-weight: 600; overflow-wrap: anywhere; }
.wb-guide { margin: 8px 0 0; }
.wb-guide-doc { margin-top: 6px; }
.wb-guide-body { max-height: 240px; margin: 4px 0 0; padding: 8px; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); font-size: 12px; white-space: pre-wrap; }
`;

// 作るものの種類。デザインガイドは部品帳の HTML と文書一式を作る
const MAKE_OPTIONS = [
  { value: "page", label: "ページ" },
  { value: "component-sheet", label: "部品帳" },
  { value: "component", label: "部品" },
  { value: "design-guide", label: "デザインガイド" },
];
// 部品の候補 (core/types.ts の COMPONENT_CANDIDATES と同じ 10 個。並びもこのとおり)
const COMPONENT_CANDIDATES = [
  { id: "button", name: "ボタン" },
  { id: "input", name: "入力欄" }, // テキスト・選択・チェック・スイッチ
  { id: "card", name: "カード" },
  { id: "nav", name: "ヘッダーのナビ" },
  { id: "tabs", name: "タブ" },
  { id: "badge", name: "バッジ/タグ" },
  { id: "modal", name: "モーダル" },
  { id: "toast", name: "トースト" },
  { id: "table", name: "表" },
  { id: "pricing-card", name: "料金カード" },
];
// 部品帳の名前 (core/component.ts の COMPONENT_SHEET_NAME と同じ)
const COMPONENT_SHEET_NAME = "部品帳";
// デザインガイドの名前と、プロジェクトの中のフォルダのファイル (core/design-guide.ts と同じ並び)
const DESIGN_GUIDE_NAME = "デザインガイド";
const DESIGN_GUIDE_FILES = ["design-guide.md", "style-guide.md", "component-sheet.html", "theme.css", "theme.json"];
// 画面に中身を出す文書
const GUIDE_DOCUMENT_NAMES = ["design-guide.md", "style-guide.md"];
// 古い style-guide で作ったデザインガイドの案内 (core/design-guide.ts の STYLE_GUIDE_UPDATE_NOTICE と同じ)
const STYLE_GUIDE_UPDATE_NOTICE = "style-guide を更新するとデザインガイドも作れます";
// 自由な名前を選んだときの値
const FREE_NAME = "";
// 部品の名前の上限 (core/component.ts の validateComponentName と同じ)
const COMPONENT_NAME_MAX = 40;
// 開き直したときに一覧へ戻す、保存したものの種類
const SAVED_KINDS = ["page", "component-sheet", "component", "design-guide"];

// HTML の属性用のエスケープ (& " < > を文字参照にする)
const escapeAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 「別タブで開く」用の文書。LLM が作ったものは、スクリプトだけ許した不透明なオリジンの iframe に入れる
// (アプリと同じオリジンの文書として開くと、ページの中のスクリプトから /api を読み書きできてしまうため)
function wrappedPageDocument(html) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>作ったページ</title></head><body style="margin:0"><iframe title="作ったページ" sandbox="allow-scripts" srcdoc="${escapeAttribute(html)}" style="position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff"></iframe></body></html>`;
}

export function createProjectPanel(ctx) {
  const { el, text, record, errorMessage, requestJson, requestText, setNote, startElapsed, JSON_HEADERS, state, nextSession } = ctx;
  const ui = {
    button: null,
    retry: null,
    progress: null,
    note: null,
    pages: null,
    open: null,
    componentRow: null,
    nameRow: null,
    nameInput: null,
    save: null,
    saveNote: null,
    projects: null,
    guide: null,
  };
  let busy = false;
  let readToken = 0;
  let makeKind = "page";
  let componentChoice = COMPONENT_CANDIDATES[0].name;
  // 中央に出している一覧の 1 件 (デザインガイドの文書を出すときに使う)
  let currentEntry = null;

  const selectOf = (value, options) => {
    const select = el("select", "wb-input");
    for (const option of options) {
      const node = el("option", null, option.label);
      node.value = option.value;
      select.append(node);
    }
    select.value = value;
    return select;
  };

  function build(root) {
    injectStyles();
    root.append(buildMakeSection(), buildSaveSection());
    renderMakes();
    void loadProjects();
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = PAGE_CSS;
    document.head.append(style);
  }

  // ---------------------------------------------------------------- 作るもの

  function buildMakeSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "make";
    section.append(el("h3", null, "作るもの"));
    section.append(
      el("p", "wb-note", "いまの依頼と見た目で、ページ・部品帳・部品・デザインガイドを LLM に作らせます。数分かかることがあります。"),
    );
    const makeSelect = selectOf(makeKind, MAKE_OPTIONS);
    makeSelect.setAttribute("aria-label", "作るもの");
    makeSelect.addEventListener("change", () => {
      makeKind = makeSelect.value;
      syncMakeFields();
    });
    const button = el("button", "btn btn-primary", "");
    button.type = "button";
    button.addEventListener("click", () => {
      void createMake();
    });
    const retry = el("button", "btn", "もう一度");
    retry.type = "button";
    retry.hidden = true;
    retry.addEventListener("click", () => {
      void createMake();
    });
    const progress = el("p", "wb-note");
    const row = el("div", "wb-row");
    row.append(el("span", "wb-caption", "作るもの"), makeSelect, button, retry, progress);

    const componentSelect = selectOf(componentChoice, [
      ...COMPONENT_CANDIDATES.map((candidate) => ({ value: candidate.name, label: candidate.name })),
      { value: FREE_NAME, label: "自由な名前" },
    ]);
    componentSelect.setAttribute("aria-label", "部品の候補");
    componentSelect.addEventListener("change", () => {
      componentChoice = componentSelect.value;
      syncMakeFields();
    });
    const componentRow = el("div", "wb-row");
    componentRow.append(el("span", "wb-caption", "部品の候補"), componentSelect);

    const nameInput = document.createElement("input");
    nameInput.className = "wb-input";
    nameInput.maxLength = COMPONENT_NAME_MAX;
    nameInput.placeholder = "例: 予約カレンダー";
    const nameRow = el("div", "wb-row");
    nameRow.append(el("span", "wb-caption", "自由な名前"), nameInput);

    const pages = el("ul", "wb-pages");
    // デザインガイドを選んでいるときだけ、文書 (design-guide.md・style-guide.md) をここに出す
    const guide = el("div", "wb-guide");
    const open = el("button", "btn", "別タブで開く");
    open.type = "button";
    open.disabled = true;
    open.addEventListener("click", () => {
      openPageInNewTab();
    });
    const actions = el("div", "wb-row");
    actions.append(open);
    const note = el("p", "wb-note");
    section.append(row, componentRow, nameRow, pages, guide, actions, note);
    ui.button = button;
    ui.retry = retry;
    ui.progress = progress;
    ui.pages = pages;
    ui.open = open;
    ui.componentRow = componentRow;
    ui.nameRow = nameRow;
    ui.nameInput = nameInput;
    ui.note = note;
    ui.guide = guide;
    syncMakeFields();
    return section;
  }

  // 作るものの選択に合わせて、部品の候補・自由な名前の入力・ボタンの文言を切り替える
  function syncMakeFields() {
    const isComponent = makeKind === "component";
    if (ui.componentRow !== null) ui.componentRow.hidden = !isComponent;
    if (ui.nameRow !== null) ui.nameRow.hidden = !isComponent || componentChoice !== FREE_NAME;
    if (ui.button !== null) ui.button.textContent = `${kindLabel(makeKind)}を作る`;
  }

  const currentPageType = () => ({ name: ctx.pageTypeName(), family: text(state.pageType.family) });

  // 送る作るもの。ページは画面の種類、部品帳・デザインガイドは種類だけ、部品は名前
  function currentMake(pageType) {
    if (makeKind === "component-sheet") return { kind: "component-sheet" };
    if (makeKind === "design-guide") return { kind: "design-guide" };
    if (makeKind === "component") return { kind: "component", name: componentName() };
    return { kind: "page", pageType };
  }

  // 部品の名前。候補を選んでいればその名前、自由な名前なら入力欄の値 (前後の空白を落とす)
  function componentName() {
    if (componentChoice !== FREE_NAME) return componentChoice;
    return ui.nameInput === null ? "" : ui.nameInput.value.trim();
  }

  function makeProblem(brief, make) {
    if (brief.what === "") return "作りたいものを書いてください";
    if (text(record(state.tuned).id) === "") return "先に案を出して、プレビューが出てから作れます";
    if (make.kind === "component" && make.name === "") return "部品の名前を書いてください";
    if (make.kind === "page" && (make.pageType.name === "" || make.pageType.family === "")) {
      return "画面の種類と骨組みを決めてください (案を出すと決まります)";
    }
    return "";
  }

  // いまの依頼と見た目で作るものを作る (POST /api/generate)。数分かかることがあるので経過秒数を出す。
  // 応答は捨てない (案の世代を進めない)。連打は busy で防ぐ
  async function createMake() {
    if (busy) return;
    const brief = ctx.collectBrief();
    const make = currentMake(currentPageType());
    const problem = makeProblem(brief, make);
    if (problem !== "") {
      setNote(ui.note, problem, true);
      return;
    }
    busy = true;
    ui.button.disabled = true;
    ui.retry.hidden = true;
    setNote(ui.note, "", false);
    const stop = startElapsed(ui.progress, `${kindLabel(make.kind)}を作っています…`);
    try {
      const body = { brief, direction: record(state.tuned), make, treatment: state.treatment };
      const payload = await requestJson("/api/generate", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const html = text(record(payload).html);
      if (html === "") throw new Error("作ったものが返りませんでした");
      const guide = make.kind === "design-guide" ? guideOfPayload(payload) : undefined;
      const entry = upsertEntry(entryOfMake(make), html, guide);
      selectEntry(entry);
      const previewNote = make.kind === "design-guide" ? "中央のプレビューに部品帳を出しています。" : "中央のプレビューに出しています。";
      setNote(ui.note, `${entryLabel(entry)}を作りました。${previewNote}`, false);
    } catch (error) {
      setNote(ui.note, `${kindLabel(make.kind)}を作れませんでした: ${errorMessage(error)}`, true);
      ui.retry.hidden = false;
    } finally {
      stop();
      ui.progress.textContent = "";
      busy = false;
      ui.button.disabled = false;
    }
  }

  // 作るものから一覧の 1 件の種類と名前を作る (部品帳・デザインガイド・部品の family は空文字)
  function entryOfMake(make) {
    if (make.kind === "component-sheet") return { kind: "component-sheet", name: COMPONENT_SHEET_NAME, family: "" };
    if (make.kind === "design-guide") return { kind: "design-guide", name: DESIGN_GUIDE_NAME, family: "" };
    if (make.kind === "component") return { kind: "component", name: make.name, family: "" };
    return { kind: "page", name: make.pageType.name, family: make.pageType.family };
  }

  // 同じ kind・同じ名前で作り直したら入れ替える (部品帳・デザインガイドは 1 件、部品は名前ごと、ページは画面の種類ごと)
  function upsertEntry(identity, html, guide) {
    const found = state.pageList.find((entry) => entry.kind === identity.kind && entry.name === identity.name);
    // dirty: 作った・作り直したが、まだ保存していない
    if (found === undefined) {
      const entry = { ...identity, key: null, html, dirty: true, guide: guide === undefined ? null : guide };
      state.pageList.push(entry);
      return entry;
    }
    found.family = identity.family;
    found.html = html;
    found.dirty = true;
    if (guide !== undefined) found.guide = guide;
    return found;
  }

  function selectEntry(entry) {
    currentEntry = entry;
    state.page = { kind: entry.kind, pageType: { name: entry.name, family: entry.family }, html: entry.html };
    ctx.showPage(state.page);
    renderMakes();
  }

  // 一覧のものに切り替える。まだ読んでいないもの (開き直したもの) は保存の API から読む
  async function openEntry(entry) {
    if (entry.html !== null && entry.html !== undefined) {
      selectEntry(entry);
      return;
    }
    if (state.projectId === null || entry.key === null) {
      setNote(ui.note, `この${kindLabel(entry.kind)}はまだ読み込めません。`, true);
      return;
    }
    readToken += 1;
    const token = readToken;
    setNote(ui.note, `${entryLabel(entry)}を読み込んでいます…`, false);
    try {
      if (entry.kind === "design-guide") {
        await loadGuideEntry(entry, token);
      } else {
        const html = await requestText(entryPathOf(entry));
        if (token !== readToken) return;
        entry.html = html;
        selectEntry(entry);
      }
      if (token !== readToken) return;
      setNote(ui.note, "", false);
    } catch (error) {
      if (token !== readToken) return;
      setNote(ui.note, `${entryLabel(entry)}を読めませんでした: ${errorMessage(error)}`, true);
    }
  }

  // 開き直したデザインガイドを読む。HTML (部品帳) と文書を読み、design-guide.md が無ければ
  // 古い style-guide で作ったものとして扱う (contract.md の 8 節)
  async function loadGuideEntry(entry, token) {
    const contents = await Promise.all(DESIGN_GUIDE_FILES.map((name) => readGuideFileOrNull(name)));
    if (token !== readToken) return;
    const files = filesOfContents(contents);
    const html = fileContentOf(files, "component-sheet.html");
    if (html === null) throw new Error("部品帳の HTML がありません");
    entry.html = html;
    entry.guide = guideOfFiles(files);
    selectEntry(entry);
  }

  // デザインガイドのファイルを 1 つ読む。無ければ null (古い style-guide のときの design-guide.md)
  async function readGuideFileOrNull(name) {
    const res = await fetch(guidePathOf(name));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return await res.text();
  }

  // 読めたファイルだけを DESIGN_GUIDE_FILES の並びで組む
  function filesOfContents(contents) {
    return DESIGN_GUIDE_FILES.flatMap((name, index) => {
      const content = contents[index];
      return content === null ? [] : [{ name, content }];
    });
  }

  // 読めたファイルから、デザインガイドの表示に使う値を作る。文書が片方でも無ければ古い style-guide とみなし、
  // 文書 2 つを外す (保存し直すときは component-sheet.html・theme.css・theme.json だけを送る)
  function guideOfFiles(files) {
    const designGuide = fileContentOf(files, "design-guide.md");
    const styleGuide = fileContentOf(files, "style-guide.md");
    const outdated = designGuide === null || styleGuide === null;
    return {
      styleGuide: outdated ? "outdated" : "ok",
      notice: outdated ? STYLE_GUIDE_UPDATE_NOTICE : "",
      files: outdated ? files.filter((file) => !GUIDE_DOCUMENT_NAMES.includes(file.name)) : files,
      dir: "",
    };
  }

  // 生成の応答 (/api/generate) の designGuide から、一覧の 1 件に持たせる値を取り出す
  function guideOfPayload(payload) {
    const guide = record(payload.designGuide);
    return {
      styleGuide: text(guide.styleGuide) === "outdated" ? "outdated" : "ok",
      notice: text(guide.notice),
      files: Array.isArray(guide.files) ? guide.files : [],
      dir: "",
    };
  }

  function fileContentOf(files, name) {
    const found = files.map((file) => record(file)).find((file) => text(file.name) === name);
    return found === undefined ? null : text(found.content);
  }

  // 保存したものの HTML の住所。ページは /pages、部品帳・部品は /components、デザインガイドは /design-guide から読む
  function entryPathOf(entry) {
    if (entry.kind === "design-guide") return guidePathOf("component-sheet.html");
    const base = `/api/projects/${encodeURIComponent(text(state.projectId))}`;
    const key = encodeURIComponent(text(entry.key));
    return entry.kind === "page" ? `${base}/pages/${key}` : `${base}/components/${key}`;
  }

  // 保存したデザインガイドのファイルの住所 (/api/projects/<id>/design-guide/<name>)
  function guidePathOf(name) {
    return `/api/projects/${encodeURIComponent(text(state.projectId))}/design-guide/${name}`;
  }

  function renderMakes() {
    const list = ui.pages;
    if (list === null) return;
    list.replaceChildren();
    if (state.pageList.length === 0) {
      list.append(el("li", "wb-note", "ページ・部品帳・部品・デザインガイドを作ると、ここに並びます。"));
    } else {
      for (const entry of state.pageList) list.append(listItemOf(entry));
    }
    ui.open.disabled = state.page === null;
    renderGuide();
  }

  // 選んでいるのがデザインガイドのときだけ、文書 (design-guide.md・style-guide.md) を読める場所を出す。
  // styleGuide が outdated のときは文書の代わりに notice を出す
  function renderGuide() {
    const box = ui.guide;
    if (box === null) return;
    box.replaceChildren();
    if (currentEntry === null) return;
    if (currentEntry.kind !== "design-guide") return;
    const guide = record(currentEntry.guide);
    if (text(guide.styleGuide) === "outdated") {
      box.append(el("p", "wb-note", guideNoticeOf(guide)));
    } else {
      for (const name of GUIDE_DOCUMENT_NAMES) {
        const content = fileContentOf(Array.isArray(guide.files) ? guide.files : [], name);
        if (content !== null) box.append(guideDocumentOf(name, content));
      }
    }
    const dir = text(guide.dir);
    if (dir !== "") box.append(el("p", "wb-note", `保存先: ${dir}`));
  }

  function guideNoticeOf(guide) {
    const notice = text(guide.notice);
    return notice === "" ? STYLE_GUIDE_UPDATE_NOTICE : notice;
  }

  // 文書 1 つ。見出し (summary) を押すと折りたためる。中身は textContent で入れる (HTML として解釈させない)
  function guideDocumentOf(name, content) {
    const details = el("details", "wb-guide-doc");
    details.open = true;
    details.append(el("summary", null, name));
    const body = el("pre", "wb-guide-body");
    body.textContent = content;
    details.append(body);
    return details;
  }

  function listItemOf(entry) {
    const item = el("li", "wb-page-entry");
    const button = el("button", "btn", entryLabel(entry));
    button.type = "button";
    const current = state.page !== null && state.page.kind === entry.kind && text(record(state.page.pageType).name) === entry.name;
    button.setAttribute("aria-pressed", String(current));
    button.addEventListener("click", () => {
      void openEntry(entry);
    });
    item.append(button);
    return item;
  }

  // 一覧のボタンの文言。種類が分かるようにする (例: 「部品帳」「デザインガイド」「部品: ボタン」「ページ: LP」)
  function entryLabel(entry) {
    if (entry.kind === "component-sheet") return COMPONENT_SHEET_NAME;
    if (entry.kind === "design-guide") return DESIGN_GUIDE_NAME;
    return `${kindLabel(entry.kind)}: ${entry.name}`;
  }

  function kindLabel(kind) {
    if (kind === "component-sheet") return "部品帳";
    if (kind === "design-guide") return "デザインガイド";
    if (kind === "component") return "部品";
    return "ページ";
  }

  function openPageInNewTab() {
    const page = state.page;
    if (page === null) return;
    if (state.pageOpenUrl !== null) URL.revokeObjectURL(state.pageOpenUrl);
    const url = URL.createObjectURL(new Blob([wrappedPageDocument(page.html)], { type: "text/html" }));
    state.pageOpenUrl = url;
    window.open(url, "_blank", "noopener");
  }

  // 新しい案でプロジェクトを捨てるとき (次の保存は新しい id になる)、前のプロジェクトのものも一緒に捨てる。
  // 一覧に前のキーを残すと、新しい id に無いものを読みに行って開けなくなる (PBI-010 差し戻し 1)
  function discardPages() {
    readToken += 1; // 途中の読み込みも捨てる
    state.pageList = [];
    state.page = null;
    currentEntry = null;
    if (state.pageOpenUrl !== null) {
      URL.revokeObjectURL(state.pageOpenUrl);
      state.pageOpenUrl = null;
    }
    renderMakes();
  }

  // ---------------------------------------------------------------- 保存と開き直し

  function buildSaveSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "save";
    section.append(el("h3", null, "保存"));
    section.append(
      el(
        "p",
        "wb-note",
        "依頼・回の履歴・パッドの点・微調整・作ったもの (ページ・部品帳・部品・デザインガイド) を保存して、あとから開き直せます。",
      ),
    );
    const button = el("button", "btn btn-primary", "保存");
    button.type = "button";
    button.addEventListener("click", () => {
      void saveProject();
    });
    const note = el("p", "wb-note");
    const row = el("div", "wb-row");
    row.append(button);
    section.append(row, note, el("h4", null, "保存済みのプロジェクト"));
    const projects = el("ul", "wb-projects");
    section.append(projects);
    ui.save = button;
    ui.saveNote = note;
    ui.projects = projects;
    return section;
  }

  function saveProblem(brief, pageType) {
    if (brief.what === "") return "作りたいものを書いてください";
    if (state.rounds.length === 0) return "先に案を出してください";
    if (pageType.name === "" || pageType.family === "") return "画面の種類と骨組みを決めてください (案を出すと決まります)";
    return "";
  }

  // 版 3 のプロジェクト (依頼・回・点・微調整・表現)。作ったもの (items) はサーバーが足す
  function projectForSave(brief, pageType) {
    return {
      version: 3,
      id: state.projectId === null ? newProjectId(brief) : state.projectId,
      brief,
      pageType,
      treatment: state.treatment,
      rounds: state.rounds,
      roundIndex: state.roundIndex,
      points: state.points,
      fineTune: state.fineTune,
      items: [],
    };
  }

  // 依頼から id の前半 (英小文字とハイフン) を作る。日本語だけの依頼は project になる
  function slugOf(value) {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug === "" ? "project" : slug.slice(0, 24).replace(/-+$/g, "");
  }

  function newProjectId(brief) {
    return `${slugOf(brief.what)}-${Date.now().toString(36)}`;
  }

  async function saveProject() {
    if (busy) return;
    const brief = ctx.collectBrief();
    const pageType = currentPageType();
    const problem = saveProblem(brief, pageType);
    if (problem !== "") {
      setNote(ui.saveNote, problem, true);
      return;
    }
    busy = true;
    ui.save.disabled = true;
    setNote(ui.saveNote, "保存しています…", false);
    try {
      const project = projectForSave(brief, pageType);
      const pending = unsavedEntries();
      // 要求 1 回に添えられるものは 1 件なので、まだ保存していないものを 1 件ずつ同じプロジェクトに送る
      // (サーバーは前に保存したものの一覧に足していく)。何も無ければプロジェクトだけを送る
      let saved = await postProject(project, pending[0]);
      for (const entry of pending.slice(1)) saved = await postProject(project, entry);
      state.projectId = text(saved.id) === "" ? text(project.id) : text(saved.id);
      setNote(ui.saveNote, `保存しました: ${state.projectId}${savedGuideLine()}`, false);
      await loadProjects();
    } catch (error) {
      setNote(ui.saveNote, `保存できませんでした: ${errorMessage(error)}`, true);
    } finally {
      busy = false;
      ui.save.disabled = false;
    }
  }

  function unsavedEntries() {
    return state.pageList.filter((entry) => entry.dirty === true && typeof entry.html === "string");
  }

  // 保存の応答の designGuideDir の案内。デザインガイドを保存していないときは空文字
  function savedGuideLine() {
    const entry = state.pageList.find((candidate) => candidate.kind === "design-guide" && text(record(candidate.guide).dir) !== "");
    if (entry === undefined) return "";
    return ` ・ デザインガイドの保存先: ${text(record(entry.guide).dir)}`;
  }

  // プロジェクトを 1 回保存する。entry があればそれを添え、保存できたら dirty を外す
  async function postProject(project, entry) {
    const body = { project };
    if (entry !== undefined) {
      if (entry.kind === "page") {
        body.page = { pageType: { name: entry.name, family: entry.family }, html: entry.html };
      } else if (entry.kind === "design-guide") {
        body.designGuide = { files: guideFilesOf(entry) };
      } else {
        body.component = { target: targetOf(entry), html: entry.html };
      }
    }
    const payload = await requestJson("/api/projects", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (entry !== undefined) entry.dirty = false;
    if (entry !== undefined && entry.kind === "design-guide") {
      // 応答の designGuideDir を「保存先」として出せるように、一覧の 1 件に持たせる
      entry.guide = { ...record(entry.guide), dir: text(record(payload).designGuideDir) };
    }
    const saved = record(record(payload).project);
    syncEntryKeys(saved.items);
    return saved;
  }

  function guideFilesOf(entry) {
    const files = record(entry.guide).files;
    return Array.isArray(files) ? files : [];
  }

  // 一覧の 1 件から、保存に送る部品の側の作るものを作る
  function targetOf(entry) {
    if (entry.kind === "component-sheet") return { kind: "component-sheet" };
    return { kind: "component", name: entry.name };
  }

  // 保存の応答の一覧 (items) から、キー (保存の住所) を手元の一覧に写す。
  // 部品帳は kind だけで、ページ・部品・デザインガイドは kind と名前で突き合わせる
  function syncEntryKeys(value) {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      const item = record(raw);
      const kind = text(item.kind);
      if (!SAVED_KINDS.includes(kind)) continue;
      if (kind === "component-sheet") {
        syncComponentSheetKey(item);
        continue;
      }
      const name = text(item.name);
      const entry = state.pageList.find((candidate) => candidate.kind === kind && candidate.name === name);
      if (entry === undefined) {
        state.pageList.push({
          kind,
          name,
          family: kind === "page" ? text(item.family) : "",
          key: text(item.key),
          html: null,
          dirty: false,
          guide: null,
        });
        continue;
      }
      if (text(item.key) !== "") entry.key = text(item.key);
      if (kind === "page" && text(item.family) !== "") entry.family = text(item.family);
    }
    renderMakes();
  }

  function syncComponentSheetKey(item) {
    const entry = state.pageList.find((candidate) => candidate.kind === "component-sheet");
    if (entry === undefined) {
      state.pageList.push({
        kind: "component-sheet",
        name: text(item.name),
        family: "",
        key: text(item.key),
        html: null,
        dirty: false,
        guide: null,
      });
      return;
    }
    if (text(item.key) !== "") entry.key = text(item.key);
  }

  async function loadProjects() {
    const list = ui.projects;
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
    list.replaceChildren(...projects.map((project) => projectItemOf(project)));
  }

  function projectItemOf(raw) {
    const project = record(raw);
    const item = el("li", "wb-project");
    const info = el("div", "wb-project-info");
    info.append(el("p", "wb-project-name", text(project.name)));
    const savedNames = (Array.isArray(project.items) ? project.items : [])
      .map((saved) => record(saved))
      .filter((saved) => SAVED_KINDS.includes(text(saved.kind)))
      .map((saved) => entryLabel({ kind: text(saved.kind), name: text(saved.name) }))
      .filter((name) => name !== "");
    const lines = [
      `${text(project.what)} ・ ${text(record(project.pageType).name)}`,
      `${dateLabel(text(project.updatedAt))} に更新`,
      savedNames.length === 0 ? "" : `作ったもの: ${savedNames.join(" / ")}`,
    ];
    for (const line of lines) {
      if (line !== "") info.append(el("p", "wb-note", line));
    }
    const id = text(project.id);
    const open = el("button", "btn", "開く");
    open.type = "button";
    open.disabled = id === "";
    open.addEventListener("click", () => {
      void openProject(id);
    });
    item.append(info, open);
    return item;
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
  }

  // 保存したプロジェクトを開く (GET /api/projects/<id>)。依頼・回・点・微調整・作ったものの一覧を戻す
  async function openProject(id) {
    if (busy || id === "") return;
    busy = true;
    setNote(ui.saveNote, "保存したプロジェクトを読み込んでいます…", false);
    const session = nextSession();
    readToken += 1; // 途中の読み込みは捨てる
    try {
      const payload = await requestJson(`/api/projects/${encodeURIComponent(id)}`);
      if (state.session !== session) return;
      const project = record(record(payload).project);
      ctx.applyProject(project);
      currentEntry = null;
      restoreDesignGuide(record(project).items);
      const entry = entryForCurrent();
      if (entry === null) {
        renderMakes();
      } else if (entry.kind === "design-guide") {
        await loadGuideEntry(entry, readToken);
        if (state.session !== session) return;
      } else {
        const html = await requestText(entryPathOf(entry));
        if (state.session !== session) return;
        entry.html = html;
        selectEntry(entry);
      }
      setNote(ui.saveNote, `「${text(record(project.brief).what)}」を開きました。`, false);
    } catch (error) {
      if (state.session !== session) return;
      setNote(ui.saveNote, `プロジェクトを開けませんでした: ${errorMessage(error)}`, true);
    } finally {
      busy = false;
    }
  }

  // 開いたときに出すもの。いまの画面の種類のページを優先し、無ければ先頭
  function entryForCurrent() {
    const wanted = text(state.pageType.name);
    return state.pageList.find((entry) => entry.kind === "page" && entry.name === wanted) ?? state.pageList[0] ?? null;
  }

  // 開き直したプロジェクトの items のデザインガイドを一覧に戻す (ui-workbench.js の pageEntriesOf は
  // ページ・部品帳・部品だけを戻すため、ここで足す)。HTML と文書は開いたときに読む
  function restoreDesignGuide(value) {
    if (!Array.isArray(value)) return;
    if (state.pageList.some((entry) => entry.kind === "design-guide")) return;
    const item = value.map((raw) => record(raw)).find((raw) => text(raw.kind) === "design-guide");
    if (item === undefined) return;
    state.pageList.push({
      kind: "design-guide",
      name: text(item.name) === "" ? DESIGN_GUIDE_NAME : text(item.name),
      family: "",
      key: text(item.key),
      html: null,
      dirty: false,
      guide: null,
    });
  }

  return { build, discardPages };
}
