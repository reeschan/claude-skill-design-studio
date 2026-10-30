// ゆるい日本語を、辞書の別名へ当てる。長い別名を先に取り、当たった範囲は重ねて取らない。
import { loadMotionDictionary } from "./motion-dictionary.ts";
import { defaultTriggerOf } from "./motion-entry.ts";
import { MOTION_TRIGGERS } from "./types.ts";
import type { MotionTriggerId } from "./types.ts";

const PART_SPLIT = /だけ|[がのをはにでとも]+/g;

export type MotionTargetAlias = { id: string; aliases: string[] };

// 言い方から対象を読むときの別名。スキーマの target は自由文なので、ここはよくある呼び方だけ
export const MOTION_TARGET_ALIASES: readonly MotionTargetAlias[] = [
  { id: "bg", aliases: ["背景"] },
  { id: "heading", aliases: ["見出し", "キャッチ", "タイトル"] },
  { id: "list", aliases: ["一覧", "リスト"] },
  { id: "cards", aliases: ["カード"] },
  { id: "photo", aliases: ["写真", "画像", "図版"] },
  { id: "nav", aliases: ["ナビ", "ナビゲーション"] },
  { id: "body", aliases: ["本文"] },
  { id: "stat", aliases: ["数字", "実績"] },
  { id: "band", aliases: ["ロゴ帯", "帯"] },
  { id: "toc", aliases: ["目次"] },
  { id: "figure", aliases: ["図解", "図"] },
  { id: "button", aliases: ["ボタン"] },
  { id: "header", aliases: ["ヘッダー", "ヘッダ"] },
];

export type AssignedEffect = {
  id: string;
  alias: string;
  start: number;
  trigger: MotionTriggerId;
  triggerExplicit: boolean;
  target?: string;
};

type AliasRow = { id: string; alias: string; parts: string[] };
type Hit = { id: string; alias: string; start: number; end: number };

export function normMotionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s、。,.!?！？「」()（）・]/g, "")
    .replace(/だけ/g, "")
    .replace(/[がのをはにでとも]/g, "");
}

export function aliasParts(alias: string): string[] {
  return alias
    .split(PART_SPLIT)
    .map((part) => normMotionText(part))
    .filter((part) => part.length >= 2);
}

function rowsOf(items: readonly { id: string; aliases: string[] }[]): AliasRow[] {
  const rows: AliasRow[] = [];
  for (const item of items) {
    const aliases = item.aliases.includes(item.id) ? item.aliases : [item.id, ...item.aliases];
    for (const alias of aliases) {
      const parts = aliasParts(alias);
      if (parts.length > 0) rows.push({ id: item.id, alias, parts });
    }
  }
  rows.sort((a, b) => partSize(b) - partSize(a));
  return rows;
}

function partSize(row: AliasRow): number {
  return row.parts.reduce((sum, part) => sum + part.length, 0);
}

function findParts(text: string, parts: readonly string[], from: number): { start: number; end: number } | null {
  let cursor = from;
  let start = -1;
  for (const part of parts) {
    const at = text.indexOf(part, cursor);
    if (at < 0) return null;
    if (start < 0) start = at;
    cursor = at + part.length;
  }
  if (start < 0) return null;
  return { start, end: cursor };
}

function overlaps(used: readonly boolean[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (used[index]) return true;
  }
  return false;
}

function findFree(text: string, parts: readonly string[], used: readonly boolean[]): { start: number; end: number } | null {
  let from = 0;
  while (from < text.length) {
    const span = findParts(text, parts, from);
    if (span === null) return null;
    if (!overlaps(used, span.start, span.end)) return span;
    from = span.start + 1;
  }
  return null;
}

function takeHits(text: string, rows: readonly AliasRow[], used: boolean[]): Hit[] {
  const hits: Hit[] = [];
  for (const row of rows) {
    if (hits.some((hit) => hit.id === row.id)) continue;
    const span = findFree(text, row.parts, used);
    if (span === null) continue;
    for (let index = span.start; index < span.end; index += 1) used[index] = true;
    hits.push({ id: row.id, alias: row.alias, start: span.start, end: span.end });
  }
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

function blankMask(length: number): boolean[] {
  return Array.from({ length }, () => false);
}

function asTrigger(id: string): MotionTriggerId {
  const found = MOTION_TRIGGERS.find((candidate) => candidate === id);
  return found ?? "on-enter";
}

function triggerFor(
  start: number,
  triggers: readonly Hit[],
  fallback: MotionTriggerId,
): { trigger: MotionTriggerId; triggerExplicit: boolean } {
  const only = triggers.length === 1 ? triggers[0] : undefined;
  if (triggers.length === 0) return { trigger: fallback, triggerExplicit: false };
  if (only !== undefined) return { trigger: asTrigger(only.id), triggerExplicit: true };
  const before = triggers.filter((hit) => hit.start <= start);
  const pick = before.length > 0 ? before[before.length - 1] : triggers[0];
  return { trigger: asTrigger(pick?.id ?? fallback), triggerExplicit: true };
}

function targetFor(start: number, targets: readonly Hit[], carried: string | undefined): string | undefined {
  if (targets.length === 0) return carried;
  const before = targets.filter((hit) => hit.start <= start);
  const pick = before.length > 0 ? before[before.length - 1] : targets[0];
  return pick?.id ?? carried;
}

function clausesOf(phrase: string): string[] {
  const parts = phrase
    .split(/[、。；;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts : [phrase.trim()].filter((part) => part !== "");
}

type ClauseBundle = { effects: AssignedEffect[]; carried: string | undefined };

function matchClause(
  clause: string,
  effectRows: AliasRow[],
  triggerRows: AliasRow[],
  targetRows: AliasRow[],
  carried: string | undefined,
): ClauseBundle {
  const text = normMotionText(clause);
  const effects = takeHits(text, effectRows, blankMask(text.length));
  const triggerMask = blankMask(text.length);
  for (const hit of effects) {
    for (let index = hit.start; index < hit.end; index += 1) triggerMask[index] = true;
  }
  const triggers = takeHits(text, triggerRows, triggerMask);
  const targets = takeHits(text, targetRows, blankMask(text.length));
  const assigned = effects.map((effect) => ({
    id: effect.id,
    alias: effect.alias,
    start: effect.start,
    ...triggerFor(effect.start, triggers, defaultTriggerOf(effect.id)),
    target: targetFor(effect.start, targets, carried),
  }));
  const lastTarget = targets.length > 0 ? targets[targets.length - 1]?.id : carried;
  return { effects: assigned, carried: lastTarget ?? carried };
}

/** 言い方を句に分け、効果・きっかけ・対象を割り当てる。強い一致が無いときは空 */
export function matchMotionPhrase(phrase: string, explicitTarget: string | undefined): AssignedEffect[] {
  const dict = loadMotionDictionary();
  const effectRows = rowsOf(dict.effects);
  const triggerRows = rowsOf(dict.triggers);
  const targetRows = rowsOf(MOTION_TARGET_ALIASES);
  let carried = explicitTarget;
  let offset = 0;
  const assigned: AssignedEffect[] = [];
  for (const clause of clausesOf(phrase)) {
    const batch = matchClause(clause, effectRows, triggerRows, targetRows, carried);
    carried = batch.carried;
    for (const effect of batch.effects) assigned.push({ ...effect, start: effect.start + offset });
    offset += normMotionText(clause).length + 1;
  }
  return assigned;
}
