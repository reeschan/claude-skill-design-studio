// 正規化した動き 1 件の検証。JSON Schema は使わず、同じ決まりを手で確かめる (実行時の依存を足さない)。
import { loadMotionDictionary } from "./motion-dictionary.ts";
import { MOTION_ANIMATED_PROPS, MOTION_IMPLS, MOTION_TRIGGERS, REDUCED_MOTION_KINDS } from "./types.ts";
import type { MotionAnimatedProp, MotionEntry, MotionImpl, MotionTriggerId, ReducedMotionKind } from "./types.ts";

export const DEFAULT_MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const BOUNCE_RE = /bounce|elastic/i;
const REDUCED_ORDER: readonly ReducedMotionKind[] = ["static", "opacity-only", "native"];

const VELOCITY_EFFECTS = new Set(["velocity-skew", "velocity-marquee"]);
const PINNED_EFFECTS = new Set(["scrollytelling", "stacking-cards", "pin-swap", "horizontal-scroll"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function effectById(id: string) {
  return loadMotionDictionary().effects.find((effect) => effect.id === id);
}

export function cssOkIds(): Set<string> {
  return new Set(
    loadMotionDictionary()
      .effects.filter((effect) => effect.cssCapability === "css")
      .map((effect) => effect.id),
  );
}

export function jsMustIds(): Set<string> {
  return new Set(
    loadMotionDictionary()
      .effects.filter((effect) => effect.cssCapability === "js")
      .map((effect) => effect.id),
  );
}

export function reducedKindOf(id: string): ReducedMotionKind {
  return effectById(id)?.reducedMotionKind ?? "static";
}

export function defaultTriggerOf(id: string): MotionTriggerId {
  return effectById(id)?.trigger ?? "on-enter";
}

// 複数の効果があるときは、一番静かな代替 (static → opacity-only → native) を取る
export function combinedReduced(ids: readonly string[]): ReducedMotionKind {
  const ranked = ids.map((id) => reducedKindOf(id)).sort((a, b) => REDUCED_ORDER.indexOf(a) - REDUCED_ORDER.indexOf(b));
  return ranked[0] ?? "static";
}

export function implOf(trigger: MotionTriggerId, ids: readonly string[]): { css_only: boolean; impl: MotionImpl } {
  const needsJs = ids.some((id) => jsMustIds().has(id)) || trigger === "velocity";
  const allCss = ids.every((id) => cssOkIds().has(id));
  const cssOnly = !needsJs && allCss;
  const impl: MotionImpl = !cssOnly ? "motion" : trigger === "on-enter" || trigger === "navigation" ? "css" : "css-sda";
  return { css_only: cssOnly, impl };
}

export function animatedPropsOf(ids: readonly string[]): MotionAnimatedProp[] {
  const props: MotionAnimatedProp[] = ["transform", "opacity"];
  if (ids.includes("blur-in")) props.push("filter");
  return props;
}

function allowedTriggers(ids: readonly string[]): MotionTriggerId[] | null {
  const limits: MotionTriggerId[][] = [];
  if (ids.some((id) => VELOCITY_EFFECTS.has(id))) limits.push(["velocity"]);
  if (ids.some((id) => PINNED_EFFECTS.has(id))) limits.push(["pinned"]);
  if (limits.length === 0) return null;
  const [first, ...rest] = limits;
  return (first ?? []).filter((id) => rest.every((set) => set.includes(id)));
}

function triggerMessage(trigger: string, ids: readonly string[]): string | null {
  const allowed = allowedTriggers(ids);
  if (allowed === null) return null;
  const list = ids.join("、");
  if (allowed.length === 0) return `効果（${list}）は、同じきっかけにまとめられません。対象かきっかけを分けてください。`;
  if (!allowed.some((id) => id === trigger)) {
    return `きっかけ「${trigger}」は、この効果（${list}）と組み合わせられません。${allowed.join(" / ")} のどれかにしてください。`;
  }
  return null;
}

function stringError(value: unknown, label: string): string | null {
  if (typeof value !== "string" || value.trim() === "") return `${label} は空でない文字列で指定してください`;
  return null;
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function effectError(value: unknown): string | null {
  if (!isList(value) || value.length < 1 || value.length > 2) return "effect は 1〜2 個で指定してください";
  const list = value;
  if (new Set(list).size !== list.length) return "effect に同じ ID が重なっています";
  const known = new Set(loadMotionDictionary().effects.map((effect) => effect.id));
  const unknownId = list.find((item) => typeof item !== "string" || !known.has(item));
  if (typeof unknownId === "string") return `辞書に無い効果です: ${unknownId}`;
  if (unknownId !== undefined) return "辞書に無い効果です";
  return null;
}

function easingError(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") return "easing は空でない文字列で指定してください";
  if (BOUNCE_RE.test(value)) return "bounce と elastic のイージングは使いません";
  return null;
}

function propsError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isList(value)) return "animated_properties は配列で指定してください";
  const list = value;
  const bad = list.find((item) => typeof item !== "string" || !MOTION_ANIMATED_PROPS.some((prop) => prop === item));
  if (bad !== undefined) return `animated_properties は ${MOTION_ANIMATED_PROPS.join(" / ")} だけです`;
  return null;
}

function pairError(entry: Record<string, unknown>, ids: string[]): string | null {
  if (entry.css_only === true && entry.impl !== "css" && entry.impl !== "css-sda") {
    return `CSS だけで書く指定なのに、実装方法が ${String(entry.impl)} になっています。`;
  }
  if (ids.some((id) => jsMustIds().has(id)) && entry.css_only !== false) {
    return "この効果は JavaScript が要るので、CSS だけでは書けません。";
  }
  return triggerMessage(String(entry.trigger), ids);
}

function enumError(value: unknown, allowed: readonly string[], message: string): string | null {
  if (typeof value === "string" && allowed.some((id) => id === value)) return null;
  return message;
}

function reasonError(value: unknown): string | null {
  if (typeof value === "string" && [...value.trim()].length >= 5) return null;
  return "reason は 5 文字以上で、なぜこの動きかを書いてください";
}

function fieldErrors(entry: Record<string, unknown>): string[] {
  const errors = [
    stringError(entry.section, "section"),
    entry.target === undefined ? null : stringError(entry.target, "target"),
    enumError(entry.trigger, MOTION_TRIGGERS, "trigger がきっかけの ID ではありません"),
    effectError(entry.effect),
    enumError(entry.impl, MOTION_IMPLS, "impl が実装方法ではありません"),
    typeof entry.css_only === "boolean" ? null : "css_only は true / false で指定してください",
    reasonError(entry.reason),
    enumError(entry.reduced_motion, REDUCED_MOTION_KINDS, "reduced_motion は static / opacity-only / native のいずれかです"),
    easingError(entry.easing),
    propsError(entry.animated_properties),
  ];
  return errors.filter((error): error is string => error !== null);
}

/** 1 件を検証し、日本語のエラーを返す。空なら通っている */
export function validateMotionEntry(value: unknown): string[] {
  if (!isRecord(value)) return ["動きの entry はオブジェクトで指定してください"];
  const errors = fieldErrors(value);
  if (errors.length > 0 || !Array.isArray(value.effect)) return errors;
  const ids = value.effect.filter((item): item is string => typeof item === "string");
  const pair = pairError(value, ids);
  return pair === null ? errors : [...errors, pair];
}

export function assertMotionEntry(entry: MotionEntry): void {
  const errors = validateMotionEntry(entry);
  if (errors.length > 0) throw new Error(errors.join(" "));
}
