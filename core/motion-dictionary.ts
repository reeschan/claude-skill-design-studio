// スクロールの動きの辞書。data/motion-dictionary.json を手で検証し、見本の台帳へ重ねる。
// 既存の見本 (spinning-border など) は data/motions.json のまま残し、同じ id は辞書の別名だけ足す。
import { fileURLToPath } from "node:url";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import { CSS_CAPABILITIES, MOTION_TRIGGERS, REDUCED_MOTION_KINDS } from "./types.ts";
import type { CssCapability, MotionSample, MotionTriggerId, ReducedMotionKind } from "./types.ts";

const DICTIONARY_FILE = fileURLToPath(new URL("../data/motion-dictionary.json", import.meta.url));

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type MotionTrigger = { id: MotionTriggerId; name: string; aliases: string[]; description: string };

export type MotionEffect = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  trigger: MotionTriggerId;
  scene: string;
  prohibition: string;
  reducedMotionKind: ReducedMotionKind;
  reducedMotion: string;
  cssCapability: CssCapability;
  description: string;
  uses: string[];
  technique: string;
  support: MotionSample["support"];
  supportNote: string;
  continuous: boolean;
  scrollLinked: boolean;
  references: string[];
  css?: string;
  html?: string;
  reuseSample: boolean;
};

export type MotionDictionary = { triggers: MotionTrigger[]; effects: MotionEffect[] };

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw inputError(`${label} は 1 件以上の文字列で指定してください`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function flag(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw inputError(`${label} は true / false で指定してください`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

function supportOf(value: unknown, label: string, reuse: boolean): MotionSample["support"] {
  if (reuse && value === undefined) return "baseline";
  return oneOf(value, ["baseline", "fallback"] as const, label);
}

function triggerRecord(x: unknown, index: number): MotionTrigger {
  if (!isRecord(x)) throw inputError(`triggers[${index}] はオブジェクトで指定してください`);
  const label = `triggers[${index}]`;
  return {
    id: oneOf(x.id, MOTION_TRIGGERS, `${label}.id`),
    name: text(x.name, `${label}.name`),
    aliases: textList(x.aliases, `${label}.aliases`),
    description: text(x.description, `${label}.description`),
  };
}

function effectSample(x: Record<string, unknown>, label: string, reuse: boolean): { css?: string; html?: string } {
  if (reuse) return {};
  return { css: text(x.css, `${label}.css`), html: text(x.html, `${label}.html`) };
}

function effectRecord(x: unknown, index: number): MotionEffect {
  if (!isRecord(x)) throw inputError(`effects[${index}] はオブジェクトで指定してください`);
  const label = `effects[${index}]`;
  const reuseSample = flag(x.reuseSample, `${label}.reuseSample`, false);
  const references = textList(x.references, `${label}.references`);
  if (references.some((url) => !url.startsWith("https://"))) throw inputError(`${label}.references は https の URL で指定してください`);
  return {
    id: text(x.id, `${label}.id`),
    name: text(x.name, `${label}.name`),
    aliases: textList(x.aliases, `${label}.aliases`),
    category: text(x.category, `${label}.category`),
    trigger: oneOf(x.trigger, MOTION_TRIGGERS, `${label}.trigger`),
    scene: text(x.scene, `${label}.scene`),
    prohibition: text(x.prohibition, `${label}.prohibition`),
    reducedMotionKind: oneOf(x.reducedMotionKind, REDUCED_MOTION_KINDS, `${label}.reducedMotionKind`),
    reducedMotion: text(x.reducedMotion, `${label}.reducedMotion`),
    cssCapability: oneOf(x.cssCapability, CSS_CAPABILITIES, `${label}.cssCapability`),
    description: text(x.description, `${label}.description`),
    uses: textList(x.uses, `${label}.uses`),
    technique: text(x.technique, `${label}.technique`),
    support: supportOf(x.support, `${label}.support`, reuseSample),
    supportNote: reuseSample && x.supportNote === undefined ? "既存の見本を使う。" : text(x.supportNote, `${label}.supportNote`),
    continuous: flag(x.continuous, `${label}.continuous`, false),
    scrollLinked: flag(x.scrollLinked, `${label}.scrollLinked`, false),
    references,
    reuseSample,
    ...effectSample(x, label, reuseSample),
  };
}

function ensureUnique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw inputError(`${label} の id が重複しています`);
}

/** data/motion-dictionary.json を読み、検証して返す */
export function loadMotionDictionary(): MotionDictionary {
  const raw = readJsonFile(DICTIONARY_FILE, "motion-dictionary");
  if (!isRecord(raw) || !Array.isArray(raw.triggers) || !Array.isArray(raw.effects)) {
    throw inputError("data/motion-dictionary.json は { triggers, effects } で指定してください");
  }
  const triggers = raw.triggers.map((entry, index) => triggerRecord(entry, index));
  const effects = raw.effects.map((entry, index) => effectRecord(entry, index));
  ensureUnique(
    triggers.map((entry) => entry.id),
    "triggers",
  );
  ensureUnique(
    effects.map((entry) => entry.id),
    "effects",
  );
  if (triggers.length !== MOTION_TRIGGERS.length) throw inputError("きっかけは 5 件です");
  return { triggers, effects };
}

function overlaySample(sample: MotionSample, effect: MotionEffect | undefined): MotionSample {
  if (effect === undefined) return sample;
  return {
    ...sample,
    aliases: effect.aliases,
    trigger: effect.trigger,
    category: effect.category,
    scene: effect.scene,
    prohibition: effect.prohibition,
    reducedMotionKind: effect.reducedMotionKind,
    cssCapability: effect.cssCapability,
  };
}

function effectToSample(effect: MotionEffect): MotionSample {
  if (effect.css === undefined || effect.html === undefined) {
    throw inputError(`効果 ${effect.id} の見本 (css と html) がありません`);
  }
  return {
    id: effect.id,
    name: effect.name,
    description: effect.description,
    aliases: effect.aliases,
    uses: effect.uses,
    technique: effect.technique,
    css: effect.css,
    html: effect.html,
    support: effect.support,
    supportNote: effect.supportNote,
    continuous: effect.continuous,
    scrollLinked: effect.scrollLinked,
    reducedMotion: effect.reducedMotion,
    references: effect.references,
    trigger: effect.trigger,
    category: effect.category,
    scene: effect.scene,
    prohibition: effect.prohibition,
    reducedMotionKind: effect.reducedMotionKind,
    cssCapability: effect.cssCapability,
  };
}

/** 既存の見本のうしろに、辞書にあって見本に無い効果を足す。同じ id は別名と辞書の項目だけ重ねる */
export function mergeMotionCatalog(base: MotionSample[], dict: MotionDictionary): MotionSample[] {
  const baseIds = new Set(base.map((sample) => sample.id));
  const byId = new Map(dict.effects.map((effect) => [effect.id, effect]));
  const enriched = base.map((sample) => overlaySample(sample, byId.get(sample.id)));
  const extra = dict.effects.filter((effect) => !baseIds.has(effect.id)).map((effect) => effectToSample(effect));
  return [...enriched, ...extra];
}
