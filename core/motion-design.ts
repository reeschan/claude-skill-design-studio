// 辞書を DESIGN.md の Motion 節として出す。impeccable の /impeccable animate <section> が読む形。
import { loadMotionDictionary } from "./motion-dictionary.ts";
import type { MotionDictionary, MotionEffect } from "./motion-dictionary.ts";
import type { MotionEntry } from "./types.ts";

const INTRO = `## Motion

このプロジェクトの動きは、下の辞書にある ID だけで指定する。プロンプトの曖昧な言い方（「ふわっと」「背景ゆっくり」など）は、まず別名と突き合わせて ID に正規化し、辞書にない ID は使わない。動きはセクション単位で当て、ページ全体を一度に書き換えない（\`/impeccable animate <section>\` に渡す前提）。`;

const SHAPE = `### 正規化の形

1セクションにつき1件。きっかけの違う動きが混ざるときは、\`target\` で要素ごとに分けて複数件にする（例：\`hero\` の \`bg\` は \`parallax\`、\`heading\` は \`fade-up\`）。\`trigger\` と \`effect\` は別の軸として持つ。

- \`target\`：任意。セクション内の要素名
- \`trigger\`：\`on-enter\` / \`scroll-linked\` / \`pinned\` / \`velocity\` / \`navigation\` のどれか1つ
- \`effect\`：下の効果 ID から1〜2個（3個以上は重ねない）
- \`impl\`：\`css\` / \`css-sda\` / \`motion\` / \`gsap\`
- \`css_only\`：\`true\` / \`false\`
- \`reason\`：必須。なぜこの動きか
- \`reduced_motion\`：必須。\`static\` / \`opacity-only\` / \`native\``;

const RULES = `### 全体の禁止事項

- bounce・elastic のイージングは使わない。基本は \`cubic-bezier(0.22, 1, 0.36, 1)\` 系の ease-out
- 動かすのは \`transform\` と \`opacity\`（と \`filter\`）だけ。\`top\`・\`left\`・\`width\`・\`height\`・\`margin\` は動かさない
- \`prefers-reduced-motion: reduce\` の代替は ID ごとに上の表どおり。動きを消しても中身と状態の変化は必ず見えるようにする
- \`css-sda\` を使うときは \`@supports (animation-timeline: view())\` で囲み、未対応ブラウザでは reduced-motion と同じ表示にする
- JavaScript が動かない環境でも中身が見える
- 1画面に主役の動きは1つ。\`parallax\` と \`scale-on-scroll\` と \`velocity-skew\` を同じ画面に重ねない`;

function cell(value: string): string {
  return value.replaceAll("|", "｜");
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((value) => cell(value)).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

function triggerTable(dict: MotionDictionary): string {
  const rows = dict.triggers.map((trigger) => [`\`${trigger.id}\``, trigger.aliases.join("、"), trigger.description]);
  return `### きっかけの軸（trigger）\n\n${table(["ID", "呼び名・別名", "中身"], rows)}`;
}

function effectRows(effects: readonly MotionEffect[]): (readonly string[])[] {
  return effects.map((effect) => [
    `\`${effect.id}\``,
    effect.aliases.join("、"),
    effect.scene,
    effect.reducedMotionKind,
    effect.prohibition,
  ]);
}

function effectTables(dict: MotionDictionary): string {
  const categories: string[] = [];
  for (const effect of dict.effects) {
    if (!categories.includes(effect.category)) categories.push(effect.category);
  }
  const sections = categories.map((category) => {
    const effects = dict.effects.filter((effect) => effect.category === category);
    const trigger = effects[0]?.trigger ?? "on-enter";
    return `#### ${category}（主に \`${trigger}\`）\n\n${table(["ID", "呼び名・別名", "使う場面", "reduced-motion", "禁止"], effectRows(effects))}`;
  });
  return `### 効果の軸（effect）\n\n${sections.join("\n\n")}`;
}

function capabilityLine(label: string, effects: readonly MotionEffect[]): string {
  const ids = effects.map((effect) => `\`${effect.id}\``).join(" ");
  return `- ${label}：${ids}`;
}

function capabilitySection(dict: MotionDictionary): string {
  const css = dict.effects.filter((effect) => effect.cssCapability === "css");
  const js = dict.effects.filter((effect) => effect.cssCapability === "js");
  const either = dict.effects.filter((effect) => effect.cssCapability === "either");
  return [
    "### CSS だけで書けるかの目安",
    capabilityLine("CSS だけで書ける", css),
    capabilityLine("JS が要る", js),
    capabilityLine("どちらでも", either),
  ].join("\n");
}

function entriesSection(entries: readonly MotionEntry[] | undefined): string {
  if (entries === undefined || entries.length === 0) return "";
  return `### このページに使う動き\n\n\`\`\`json\n${JSON.stringify(entries, null, 2)}\n\`\`\``;
}

/** 辞書、または正規化済みの entry を含む Motion 節 */
export function motionDesignMarkdown(entries?: readonly MotionEntry[]): string {
  const dict = loadMotionDictionary();
  return [INTRO, SHAPE, entriesSection(entries), triggerTable(dict), effectTables(dict), capabilitySection(dict), RULES]
    .filter((part) => part !== "")
    .join("\n\n");
}
