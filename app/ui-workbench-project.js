// 作業台の右の列の後半 (ページ・保存)。ページを作って中央のプレビューに出し、プロジェクトとして保存・開き直す。
// LLM のページは sandbox="allow-scripts" の iframe に包んで別タブで開く (アプリの API に届かないように)。
// ページ作りと保存は、案の世代 (state.session) を進めない。進めると、出している途中の案やページの応答が
// 知らせなしに捨てられる (ページ作りは数分かかる)。連打は busy の印で防ぐ。
// 状態を変える処理と DOM を作る処理を分け、状態・API・描き直しは呼び出し元 (ui-workbench.js) から受け取る。
const PAGE_CSS = `
.wb-pages { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.wb-page-entry button[aria-pressed="true"] { border-color: transparent; background: var(--accent-soft); color: var(--accent-soft-fg); font-weight: 700; }
.wb-projects { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wb-project { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
.wb-project p { margin: 0; }
.wb-project-info { min-width: 0; }
.wb-project-name { font-weight: 600; overflow-wrap: anywhere; }
`;

// HTML の属性用のエスケープ (& " < > を文字参照にする)
const escapeAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 「別タブで開く」用の文書。LLM のページは、スクリプトだけ許した不透明なオリジンの iframe に入れる
// (アプリと同じオリジンの文書として開くと、ページの中のスクリプトから /api を読み書きできてしまうため)
function wrappedPageDocument(html) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>作ったページ</title></head><body style="margin:0"><iframe title="作ったページ" sandbox="allow-scripts" srcdoc="${escapeAttribute(html)}" style="position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff"></iframe></body></html>`;
}

export function createProjectPanel(ctx) {
  const { el, text, record, errorMessage, requestJson, requestText, setNote, startElapsed, JSON_HEADERS, state, nextSession } = ctx;
  const ui = { button: null, retry: null, progress: null, note: null, pages: null, open: null, save: null, saveNote: null, projects: null };
  let busy = false;
  let readToken = 0;

  function build(root) {
    injectStyles();
    root.append(buildPageSection(), buildSaveSection());
    renderPages();
    void loadProjects();
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = PAGE_CSS;
    document.head.append(style);
  }

  // ---------------------------------------------------------------- ページ

  function buildPageSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "page";
    section.append(el("h3", null, "ページ"));
    section.append(el("p", "wb-note", "いまの依頼と見た目で、1 ファイルの HTML ページを LLM に作らせます。数分かかることがあります。"));
    const button = el("button", "btn btn-primary", "ページを作る");
    button.type = "button";
    button.addEventListener("click", () => {
      void createPage();
    });
    const retry = el("button", "btn", "もう一度");
    retry.type = "button";
    retry.hidden = true;
    retry.addEventListener("click", () => {
      void createPage();
    });
    const progress = el("p", "wb-note");
    const row = el("div", "wb-row");
    row.append(button, retry, progress);
    const pages = el("ul", "wb-pages");
    const open = el("button", "btn", "別タブで開く");
    open.type = "button";
    open.disabled = true;
    open.addEventListener("click", () => {
      openPageInNewTab();
    });
    const actions = el("div", "wb-row");
    actions.append(open);
    const note = el("p", "wb-note");
    section.append(row, pages, actions, note);
    ui.button = button;
    ui.retry = retry;
    ui.progress = progress;
    ui.pages = pages;
    ui.open = open;
    ui.note = note;
    return section;
  }

  const currentPageType = () => ({ name: ctx.pageTypeName(), family: text(state.pageType.family) });

  function pageProblem(brief, pageType) {
    if (brief.what === "") return "作りたいものを書いてください";
    if (text(record(state.tuned).id) === "") return "先に案を出して、プレビューが出てから作れます";
    if (pageType.name === "" || pageType.family === "") return "画面の種類と骨組みを決めてください (案を出すと決まります)";
    return "";
  }

  // いまの依頼と見た目でページを作る (POST /api/page)。数分かかることがあるので経過秒数を出す。
  // 応答は捨てない (案の世代を進めない)。連打は busy で防ぐ
  async function createPage() {
    if (busy) return;
    const brief = ctx.collectBrief();
    const pageType = currentPageType();
    const problem = pageProblem(brief, pageType);
    if (problem !== "") {
      setNote(ui.note, problem, true);
      return;
    }
    busy = true;
    ui.button.disabled = true;
    ui.retry.hidden = true;
    setNote(ui.note, "", false);
    const stop = startElapsed(ui.progress, "ページを作っています…");
    try {
      const body = { brief, direction: record(state.tuned), pageType };
      const payload = await requestJson("/api/page", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const html = text(record(payload).html);
      if (html === "") throw new Error("ページが返りませんでした");
      selectEntry(upsertPage(pageType, html));
      setNote(ui.note, `ページができました (${pageType.name})。中央のプレビューに出しています。`, false);
    } catch (error) {
      setNote(ui.note, `ページを作れませんでした: ${errorMessage(error)}`, true);
      ui.retry.hidden = false;
    } finally {
      stop();
      ui.progress.textContent = "";
      busy = false;
      ui.button.disabled = false;
    }
  }

  // 画面の種類ごとに 1 件。同じ名前で作り直したら入れ替える
  function upsertPage(pageType, html) {
    const found = state.pageList.find((entry) => entry.name === pageType.name);
    if (found === undefined) {
      const entry = { name: pageType.name, family: pageType.family, key: null, html };
      state.pageList.push(entry);
      return entry;
    }
    found.family = pageType.family;
    found.html = html;
    return found;
  }

  function selectEntry(entry) {
    state.page = { pageType: { name: entry.name, family: entry.family }, html: entry.html };
    ctx.showPage(state.page);
    renderPages();
  }

  // 一覧のページに切り替える。まだ読んでいないページ (開き直したもの) は保存の API から読む
  async function openEntry(entry) {
    if (entry.html !== null && entry.html !== undefined) {
      selectEntry(entry);
      return;
    }
    if (state.projectId === null || entry.key === null) {
      setNote(ui.note, "このページはまだ読み込めません。", true);
      return;
    }
    readToken += 1;
    const token = readToken;
    setNote(ui.note, `ページを読み込んでいます… (${entry.name})`, false);
    try {
      const html = await requestText(pagePathOf(entry));
      if (token !== readToken) return;
      entry.html = html;
      selectEntry(entry);
      setNote(ui.note, "", false);
    } catch (error) {
      if (token !== readToken) return;
      setNote(ui.note, `ページを読めませんでした: ${errorMessage(error)}`, true);
    }
  }

  function pagePathOf(entry) {
    return `/api/projects/${encodeURIComponent(text(state.projectId))}/pages/${encodeURIComponent(text(entry.key))}`;
  }

  function renderPages() {
    const list = ui.pages;
    if (list === null) return;
    list.replaceChildren();
    if (state.pageList.length === 0) {
      list.append(el("li", "wb-note", "ページを作ると、画面の種類ごとにここに並びます。"));
    } else {
      for (const entry of state.pageList) list.append(pageEntryOf(entry));
    }
    ui.open.disabled = state.page === null;
  }

  function pageEntryOf(entry) {
    const item = el("li", "wb-page-entry");
    const button = el("button", "btn", entry.name);
    button.type = "button";
    const current = state.page !== null && text(record(state.page.pageType).name) === entry.name;
    button.setAttribute("aria-pressed", String(current));
    button.addEventListener("click", () => {
      void openEntry(entry);
    });
    item.append(button);
    return item;
  }

  function openPageInNewTab() {
    const page = state.page;
    if (page === null) return;
    if (state.pageOpenUrl !== null) URL.revokeObjectURL(state.pageOpenUrl);
    const url = URL.createObjectURL(new Blob([wrappedPageDocument(page.html)], { type: "text/html" }));
    state.pageOpenUrl = url;
    window.open(url, "_blank", "noopener");
  }

  // 新しい案でプロジェクトを捨てるとき (次の保存は新しい id になる)、前のプロジェクトのページも一緒に捨てる。
  // 一覧に前のキーを残すと、新しい id に無いページを読みに行って開けなくなる (PBI-010 差し戻し 1)
  function discardPages() {
    readToken += 1; // 途中のページの読み込みも捨てる
    state.pageList = [];
    state.page = null;
    if (state.pageOpenUrl !== null) {
      URL.revokeObjectURL(state.pageOpenUrl);
      state.pageOpenUrl = null;
    }
    renderPages();
  }

  // ---------------------------------------------------------------- 保存と開き直し

  function buildSaveSection() {
    const section = el("section", "wb-section");
    section.dataset.panel = "save";
    section.append(el("h3", null, "保存"));
    section.append(el("p", "wb-note", "依頼・回の履歴・パッドの点・微調整・ページを保存して、あとから開き直せます。"));
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

  // 版 2 のプロジェクト (依頼・回・点・微調整)。ページは今のものを別に添える
  function projectForSave(brief, pageType) {
    return {
      version: 2,
      id: state.projectId === null ? newProjectId(brief) : state.projectId,
      brief,
      pageType,
      rounds: state.rounds,
      roundIndex: state.roundIndex,
      points: state.points,
      fineTune: state.fineTune,
      pages: [],
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
      const body = { project };
      const page = state.page;
      if (page !== null) body.page = { pageType: page.pageType, html: page.html };
      const payload = await requestJson("/api/projects", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const saved = record(record(payload).project);
      state.projectId = text(saved.id) === "" ? text(project.id) : text(saved.id);
      syncPageKeys(saved.pages);
      setNote(ui.saveNote, `保存しました: ${state.projectId}`, false);
      await loadProjects();
    } catch (error) {
      setNote(ui.saveNote, `保存できませんでした: ${errorMessage(error)}`, true);
    } finally {
      busy = false;
      ui.save.disabled = false;
    }
  }

  // 保存の応答のページの一覧から、キー (保存の住所) を手元の一覧に写す
  function syncPageKeys(value) {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      const page = record(raw);
      const name = text(page.name);
      const entry = state.pageList.find((item) => item.name === name);
      if (entry === undefined) {
        state.pageList.push({ name, family: text(page.family), key: text(page.key), html: null });
        continue;
      }
      if (text(page.key) !== "") entry.key = text(page.key);
      if (text(page.family) !== "") entry.family = text(page.family);
    }
    renderPages();
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
    const pageNames = (Array.isArray(project.pages) ? project.pages : [])
      .map((page) => text(record(page).name))
      .filter((name) => name !== "");
    const lines = [
      `${text(project.what)} ・ ${text(record(project.pageType).name)}`,
      `${dateLabel(text(project.updatedAt))} に更新`,
      pageNames.length === 0 ? "" : `ページ: ${pageNames.join(" / ")}`,
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

  // 保存したプロジェクトを開く (GET /api/projects/<id>)。依頼・回・点・微調整・ページの一覧を戻す
  async function openProject(id) {
    if (busy || id === "") return;
    busy = true;
    setNote(ui.saveNote, "保存したプロジェクトを読み込んでいます…", false);
    const session = nextSession();
    readToken += 1; // 途中のページの読み込みは捨てる
    try {
      const payload = await requestJson(`/api/projects/${encodeURIComponent(id)}`);
      if (state.session !== session) return;
      const project = record(record(payload).project);
      ctx.applyProject(project);
      const entry = entryForCurrent();
      if (entry === null) {
        renderPages();
      } else {
        const html = await requestText(pagePathOf(entry));
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

  // 開いたときに出すページ。いまの画面の種類のものを優先し、無ければ先頭
  function entryForCurrent() {
    const wanted = text(state.pageType.name);
    return state.pageList.find((entry) => entry.name === wanted) ?? state.pageList[0] ?? null;
  }

  return { build, discardPages };
}
