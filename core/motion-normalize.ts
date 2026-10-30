// セクションとゆるい言い方から、検証済みの動き entry を作る。きっかけが混ざるときは対象ごとに分ける。
import { loadMotionDictionary } from "./motion-dictionary.ts";
import { animatedPropsOf, combinedReduced, DEFAULT_MOTION_EASING, defaultTriggerOf, implOf, validateMotionEntry } from "./motion-entry.ts";
import { matchMotionPhrase, normMotionText, MOTION_TARGET_ALIASES } from "./motion-match.ts";
import type { AssignedEffect } from "./motion-match.ts";
import { fuzzyEffects, jevEffectScores, searchMotions } from "./motion-rank.ts";
import type { MotionEntry, MotionTriggerId } from "./types.ts";

export type NormalizeInput = { section: string; phrase: string; target?: string; reason?: string };

export type NormalizeOk = { ok: true; entries: MotionEntry[]; notes: string[]; source: "alias" | "jev" };
export type NormalizeErr = { ok: false; errors: string[] };
export type NormalizeResult = NormalizeOk | NormalizeErr;

type Group = { trigger: MotionTriggerId; target?: string; explicit: boolean; effects: AssignedEffect[] };

const NOT_FOUND = "辞書の別名に当たる言い方が見つかりませんでした。見本ページの ID か、辞書の呼び名で指定してください。";

function lengthOf(value: string): number {
  return [...value.trim()].length;
}

function inputErrors(input: NormalizeInput): string[] {
  const errors: string[] = [];
  if (input.section.trim() === "") errors.push("section は空でない文字列で指定してください");
  if (input.phrase.trim() === "") errors.push("言い方が空です");
  if (input.reason !== undefined && lengthOf(input.reason) < 5) errors.push("reason は 5 文字以上で、なぜこの動きかを書いてください");
  if (input.target !== undefined && input.target.trim() === "") errors.push("target は空でない文字列で指定してください");
  return errors;
}

function loneTarget(phrase: string, explicit: string | undefined): string | undefined {
  if (explicit !== undefined) return explicit;
  const text = normMotionText(phrase);
  const hits = MOTION_TARGET_ALIASES.filter((item) => item.aliases.some((alias) => text.includes(normMotionText(alias))));
  return hits.length === 1 ? hits[0]?.id : undefined;
}

function fromFuzzy(phrase: string, explicit: string | undefined): AssignedEffect[] {
  const target = loneTarget(phrase, explicit);
  return fuzzyEffects(phrase).map((hit, index) => ({
    id: hit.id,
    alias: hit.hit,
    start: index,
    trigger: defaultTriggerOf(hit.id),
    triggerExplicit: false,
    target,
  }));
}

function notFound(phrase: string): string {
  const effectIds = new Set(loadMotionDictionary().effects.map((effect) => effect.id));
  const legacy = searchMotions(phrase).find((hit) => !effectIds.has(hit.id) && hit.score >= 8);
  if (legacy === undefined) return NOT_FOUND;
  return `「${legacy.name}」は見本の id（${legacy.id}）です。辞書の効果には当たりませんでした。見本の id で指定するか、辞書の呼び名で言い換えてください。`;
}

function groupEffects(effects: readonly AssignedEffect[]): Group[] {
  const groups: Group[] = [];
  for (const effect of effects) {
    const found = groups.find((group) => group.trigger === effect.trigger && group.target === effect.target);
    if (found) {
      if (!found.effects.some((item) => item.id === effect.id)) found.effects.push(effect);
      if (effect.triggerExplicit) found.explicit = true;
      continue;
    }
    groups.push({ trigger: effect.trigger, target: effect.target, explicit: effect.triggerExplicit, effects: [effect] });
  }
  return groups;
}

function orderEffects(effects: readonly AssignedEffect[], scores: Map<string, number> | null): AssignedEffect[] {
  return [...effects].sort((a, b) => (scores?.get(b.id) ?? 0) - (scores?.get(a.id) ?? 0) || a.start - b.start);
}

function entryOf(section: string, group: Group, kept: readonly AssignedEffect[], phrase: string, reason: string | undefined): MotionEntry {
  const ids = kept.map((effect) => effect.id);
  const impl = implOf(group.trigger, ids);
  const entry: MotionEntry = {
    section: section.trim(),
    trigger: group.trigger,
    effect: ids,
    impl: impl.impl,
    css_only: impl.css_only,
    reason: reason?.trim() ?? `「${phrase.trim()}」から正規化（${kept.map((effect) => `${effect.alias}→${effect.id}`).join("、")}）`,
    reduced_motion: combinedReduced(ids),
    easing: DEFAULT_MOTION_EASING,
    animated_properties: animatedPropsOf(ids),
  };
  if (group.target !== undefined) entry.target = group.target;
  return entry;
}

function notesFor(groups: readonly Group[], dropped: readonly string[], jevNote: string | undefined): string[] {
  const notes: string[] = [];
  if (jevNote !== undefined) notes.push(jevNote);
  if (groups.length > 1) notes.push(`きっかけや対象が違うので、${groups.length} 件に分けました。`);
  for (const group of groups) {
    const first = group.effects[0];
    if (!group.explicit && first !== undefined)
      notes.push(`きっかけの指定がなかったので、${first.id} の既定「${group.trigger}」にしました。`);
  }
  if (dropped.length > 0) notes.push(`効果は 1 件あたり 2 個までです。残り: ${dropped.join("、")}`);
  return notes;
}

async function sourceOf(
  phrase: string,
  ids: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ scores: Map<string, number> | null; source: "alias" | "jev"; note?: string }> {
  const scored = await jevEffectScores(phrase, ids, env);
  if (scored === null) return { scores: null, source: "alias" };
  if (scored === "fail") return { scores: null, source: "alias", note: "Jev に聞けなかったので、別名の一致のままにしました。" };
  return { scores: scored, source: "jev" };
}

/** 言い方を entry にする。検証に落ちた組み合わせは日本語のエラーで返す */
export async function normalizeMotion(input: NormalizeInput, env: NodeJS.ProcessEnv): Promise<NormalizeResult> {
  const early = inputErrors(input);
  if (early.length > 0) return { ok: false, errors: early };
  const matched = matchMotionPhrase(input.phrase, input.target);
  const assigned = matched.length > 0 ? matched : fromFuzzy(input.phrase, input.target);
  if (assigned.length === 0) return { ok: false, errors: [notFound(input.phrase)] };
  const groups = groupEffects(assigned);
  const ranked = await sourceOf(
    input.phrase,
    assigned.map((effect) => effect.id),
    env,
  );
  const dropped: string[] = [];
  const entries = groups.map((group) => {
    const ordered = orderEffects(group.effects, ranked.scores);
    dropped.push(...ordered.slice(2).map((effect) => effect.id));
    return entryOf(input.section, group, ordered.slice(0, 2), input.phrase, input.reason);
  });
  const errors = entries.flatMap((entry) => validateMotionEntry(entry));
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, entries, notes: notesFor(groups, dropped, ranked.note), source: ranked.source };
}
