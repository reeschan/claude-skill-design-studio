// 台帳の画面。GET /api/catalog の一覧を段階 (方向性 → テーマ → ページ → 点検 → 仕上げ) と
// 役割ごとに並べ、各スキルの使う/使わないを POST /api/catalog/enabled で切り替える。
// 段階と役割の名前は CONTEXT.md の用語にそろえる。導入はしない (計画は GET /api/install-plan)
const STAGES = [
  { key: "direction", label: "方向性" },
  { key: "theme", label: "テーマ" },
  { key: "page", label: "ページ" },
  { key: "review", label: "点検" },
  { key: "polish", label: "仕上げ" },
];

const state = { status: null };

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

// 外部入力の検証は手で書く (core の validate* と同じ形)
function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

function prerequisiteList(value) {
  if (!Array.isArray(value)) return [];
  const list = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const label = text(item.label);
    const command = text(item.command);
    if (label === "" || command === "") continue;
    list.push({ label, command });
  }
  return list;
}

function normalizeEntry(raw) {
  const entry = record(raw);
  return {
    id: text(entry.id),
    name: text(entry.name),
    stage: text(entry.stage),
    role: text(entry.role),
    roleLabel: text(entry.roleLabel),
    isDefault: entry.isDefault === true,
    installed: entry.installed === true,
    enabled: entry.enabled !== false,
    origin: entry.origin === "local" ? "local" : "bundled",
    target: entry.target === "react" ? "react" : "any",
    license: text(entry.license),
    summary: text(entry.summary),
    exampleRequest: text(entry.exampleRequest),
    exampleOutput: text(entry.exampleOutput),
    notes: stringList(entry.notes),
    prerequisites: prerequisiteList(entry.prerequisites),
  };
}

// 導入の計画 (GET /api/install-plan)。アプリからは導入せず、案内だけを出す
function normalizePlanItem(raw) {
  const item = record(raw);
  const source = record(item.source);
  const name = text(item.name) === "" ? text(item.id) : text(item.name);
  const commands = stringList(item.commands);
  return { action: text(item.action), name, source, commands };
}

function planDetail(item) {
  if (item.action === "manual") return item.commands.join(" / ");
  if (item.source.type === "github") return text(item.source.repo);
  return "";
}

function setStatus(message, isError) {
  if (state.status === null) return;
  state.status.textContent = message;
  state.status.classList.toggle("status-error", isError === true);
}

function badge(label, alert) {
  return el("span", alert === true ? "badge badge-alert" : "badge", label);
}

function badgesFor(entry) {
  const box = el("div", "badges");
  box.append(badge(entry.isDefault ? "既定" : "候補", false));
  box.append(badge(entry.installed ? "導入済み" : "未導入", !entry.installed));
  if (entry.target === "react") box.append(badge("React プロジェクト専用", false));
  if (entry.origin === "local") box.append(badge("追加", false));
  return box;
}

async function copyCommand(button, command) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = "コピーしました";
  } catch {
    button.textContent = "コピーできません。手で選んでください";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 2000);
}

function prerequisiteBlock(prerequisite) {
  const block = el("div", "prereq");
  block.append(el("h4", null, `前提: ${prerequisite.label}`));
  const row = el("div", "prereq-row");
  const command = el("code", null, prerequisite.command);
  const copy = el("button", "btn", "コピー");
  copy.type = "button";
  copy.addEventListener("click", () => {
    void copyCommand(copy, prerequisite.command);
  });
  row.append(command, copy);
  block.append(row);
  return block;
}

function detailsFor(entry) {
  const details = el("details", "details");
  details.append(el("summary", null, "依頼の例と、返ってくるものの例"));
  details.append(el("h4", null, "依頼の例"));
  details.append(el("pre", null, entry.exampleRequest));
  details.append(el("h4", null, "返ってくるものの例"));
  details.append(el("pre", null, entry.exampleOutput));
  if (entry.notes.length > 0) {
    details.append(el("h4", null, "覚えておくこと"));
    const notes = el("ul", "notes");
    for (const note of entry.notes) notes.append(el("li", null, note));
    details.append(notes);
  }
  for (const prerequisite of entry.prerequisites) details.append(prerequisiteBlock(prerequisite));
  return details;
}

async function saveEnabled(entry, input, caption) {
  const wanted = input.checked;
  input.disabled = true;
  setStatus("", false);
  try {
    await requestJson("/api/catalog/enabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, enabled: wanted }),
    });
    entry.enabled = wanted;
    setStatus(`「${entry.name}」を${wanted ? "使う" : "使わない"}にしました。`, false);
  } catch (error) {
    input.checked = !wanted;
    entry.enabled = !wanted;
    setStatus(`「${entry.name}」の設定を保存できませんでした: ${errorMessage(error)}`, true);
  } finally {
    input.disabled = false;
    caption.textContent = input.checked ? "使う" : "使わない";
  }
}

function switchField(entry) {
  const label = el("label", "switch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = entry.enabled;
  input.setAttribute("aria-label", `${entry.name} を使う`);
  const caption = el("span", null, entry.enabled ? "使う" : "使わない");
  input.addEventListener("change", () => {
    void saveEnabled(entry, input, caption);
  });
  label.append(input, caption);
  return label;
}

function card(entry) {
  const box = el("article", "card");
  const head = el("div", "card-head");
  head.append(el("h5", "card-name", entry.name), switchField(entry));
  box.append(head);
  box.append(badgesFor(entry));
  box.append(el("p", "card-summary", entry.summary));
  box.append(el("p", "card-meta", `ライセンス: ${entry.license === "" ? "不明" : entry.license}`));
  box.append(detailsFor(entry));
  return box;
}

function rolesOf(entries) {
  const roles = [];
  for (const entry of entries) {
    if (roles.some((role) => role.key === entry.role)) continue;
    roles.push({ key: entry.role, label: entry.roleLabel === "" ? entry.role : entry.roleLabel });
  }
  return roles;
}

function roleBlock(role, entries) {
  const box = el("section", "role");
  box.append(el("h4", "role-title", role.label));
  const cards = el("div", "cards");
  for (const entry of entries.filter((item) => item.role === role.key)) cards.append(card(entry));
  box.append(cards);
  return box;
}

function stageBlock(stage, entries) {
  const box = el("section", "stage");
  box.append(el("h3", "stage-title", stage.label));
  if (stage.key === "direction") {
    box.append(el("p", "stage-note", "design-studio 自身が受け持つ段階です。曖昧な一言から方向性の案を作り、次の段階へ渡します。"));
    return box;
  }
  const inStage = entries.filter((entry) => entry.stage === stage.key);
  if (inStage.length === 0) {
    box.append(el("p", "stage-note", "この段階のスキルはありません。"));
    return box;
  }
  for (const role of rolesOf(inStage)) box.append(roleBlock(role, inStage));
  return box;
}

function planList(title, items) {
  const box = el("div", null);
  box.append(el("h4", null, title));
  const list = el("ul", "install-list");
  for (const item of items) {
    const detail = planDetail(item);
    list.append(el("li", null, detail === "" ? item.name : `${item.name} (${detail})`));
  }
  box.append(list);
  return box;
}

async function fillInstall(box) {
  box.append(el("h3", "stage-title", "足りないスキルを入れる"));
  box.append(
    el("p", "stage-note", "Claude Code で /design-studio install を実行すると、確認のうえで入ります。このアプリからは導入しません。"),
  );
  const status = el("p", "status");
  box.append(status);
  let payload = null;
  try {
    payload = await requestJson("/api/install-plan");
  } catch (error) {
    status.textContent = `導入の計画を読み込めませんでした: ${errorMessage(error)}`;
    status.classList.add("status-error");
    return;
  }
  const planValue = record(payload).plan;
  const plan = (Array.isArray(planValue) ? planValue : []).map(normalizePlanItem);
  const installed = plan.filter((item) => item.action === "installed");
  const clone = plan.filter((item) => item.action === "clone");
  const manual = plan.filter((item) => item.action === "manual");
  box.append(
    el(
      "p",
      null,
      `台帳の ${plan.length} 件のうち、導入済みが ${installed.length} 件、これから入れるものが ${clone.length} 件、手で入れるものが ${manual.length} 件です。`,
    ),
  );
  if (clone.length > 0) box.append(planList("これから入れるもの", clone));
  if (manual.length > 0) box.append(planList("手で入れるもの (プラグイン)", manual));
}

async function load() {
  const root = document.getElementById("catalog");
  if (root === null) return;
  root.append(
    el("h2", "screen-title", "台帳"),
    el("p", "screen-lead", "design-studio が扱うスキルの一覧です。どの段階で、何に使うかを確かめて、使う/使わないを選べます。"),
  );
  state.status = el("p", "status");
  root.append(state.status);
  const stages = el("div", null);
  const install = el("section", "install");
  root.append(stages, install);

  let payload = null;
  try {
    payload = await requestJson("/api/catalog");
  } catch (error) {
    setStatus(`台帳を読み込めませんでした: ${errorMessage(error)}`, true);
    return;
  }
  const entriesValue = record(payload).entries;
  const entries = (Array.isArray(entriesValue) ? entriesValue : []).map(normalizeEntry);
  for (const stage of STAGES) stages.append(stageBlock(stage, entries));
  await fillInstall(install);
}

void load();
