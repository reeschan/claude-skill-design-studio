// 表現 (面 × 動き × 指定した見本) の core。data/surfaces.json と data/motions.json を読み、検証する。
// 外部入力の検証は core/styles.ts に倣って手で書く
import { fileURLToPath } from "node:url";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import { pageHtml } from "./page-html.ts";
import { MOTION_LEVELS } from "./types.ts";
import type { BaseMode, MotionLevel, MotionSample, SurfaceEntry, Treatment } from "./types.ts";

// core/treatment.ts の 1 つ上 = リポジトリのルート
const SURFACES_FILE = fileURLToPath(new URL("../data/surfaces.json", import.meta.url));
const MOTIONS_FILE = fileURLToPath(new URL("../data/motions.json", import.meta.url));

// 動きの見本の指定は 0〜4 件 (取り決めの 1 節)
const SAMPLE_MAX = 4;

const SUPPORTS: readonly MotionSample["support"][] = ["baseline", "fallback"];
const SURFACE_ID_RE = /^[a-z][a-z0-9-]*$/;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 空でない文字列
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

// 文字列 (空を許す。面の css のように空のときがあるもの)
function freeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw inputError(`${label} は文字列で指定してください`);
  return value;
}

// 空でない文字列の配列 (空の配列は許す)
function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw inputError(`${label} は文字列の配列で指定してください`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

// 真偽値
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw inputError(`${label} は true / false で指定してください`);
  return value;
}

// id の形 (英小文字で始まる英小文字・数字・ハイフン)
function idOf(value: unknown, label: string): string {
  const id = text(value, label);
  if (!SURFACE_ID_RE.test(id)) throw inputError(`${label} は /^[a-z][a-z0-9-]*$/ に合う文字列で指定してください`);
  return id;
}

// 列挙のいずれか
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

// 面の台帳の 1 件
function surfaceOf(x: unknown, index: number): SurfaceEntry {
  if (!isRecord(x)) throw inputError(`surfaces[${index}] はオブジェクトで指定してください`);
  const label = `surfaces[${index}]`;
  return {
    id: idOf(x.id, `${label}.id`),
    name: text(x.name, `${label}.name`),
    description: text(x.description, `${label}.description`),
    instructions: textList(x.instructions, `${label}.instructions`),
    css: freeText(x.css, `${label}.css`),
    examples: textList(x.examples, `${label}.examples`),
  };
}

// 動きの見本の 1 件
function motionOf(x: unknown, index: number): MotionSample {
  if (!isRecord(x)) throw inputError(`motions[${index}] はオブジェクトで指定してください`);
  const label = `motions[${index}]`;
  const references = textList(x.references, `${label}.references`);
  if (references.length === 0) throw inputError(`${label}.references は 1 件以上で指定してください`);
  if (references.some((url) => !url.startsWith("https://"))) {
    throw inputError(`${label}.references は https の URL で指定してください`);
  }
  return {
    id: idOf(x.id, `${label}.id`),
    name: text(x.name, `${label}.name`),
    description: text(x.description, `${label}.description`),
    uses: textList(x.uses, `${label}.uses`),
    technique: text(x.technique, `${label}.technique`),
    css: text(x.css, `${label}.css`),
    html: text(x.html, `${label}.html`),
    support: oneOf(x.support, SUPPORTS, `${label}.support`),
    supportNote: text(x.supportNote, `${label}.supportNote`),
    continuous: bool(x.continuous, `${label}.continuous`),
    scrollLinked: bool(x.scrollLinked, `${label}.scrollLinked`),
    reducedMotion: text(x.reducedMotion, `${label}.reducedMotion`),
    references,
  };
}

// id の重複を止める
function ensureUniqueIds(entries: readonly { id: string }[], label: string): void {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw inputError(`${label} の id が重複しています`);
}

/** data/surfaces.json を読み、検証して返す */
export function loadSurfaces(): SurfaceEntry[] {
  const raw = readJsonFile(SURFACES_FILE, "surfaces");
  if (!isRecord(raw) || !Array.isArray(raw.surfaces)) {
    throw inputError("data/surfaces.json は { surfaces: [...] } で指定してください");
  }
  const surfaces = raw.surfaces.map((entry, index) => surfaceOf(entry, index));
  ensureUniqueIds(surfaces, "data/surfaces.json");
  return surfaces;
}

/** data/motions.json を読み、検証して返す */
export function loadMotions(): MotionSample[] {
  const raw = readJsonFile(MOTIONS_FILE, "motions");
  if (!isRecord(raw) || !Array.isArray(raw.motions)) {
    throw inputError("data/motions.json は { motions: [...] } で指定してください");
  }
  const motions = raw.motions.map((entry, index) => motionOf(entry, index));
  ensureUniqueIds(motions, "data/motions.json");
  return motions;
}

/** id に一致する面。無ければ undefined */
export function findSurface(id: string): SurfaceEntry | undefined {
  return loadSurfaces().find((surface) => surface.id === id);
}

/** id に一致する動きの見本。無ければ undefined */
export function findMotion(id: string): MotionSample | undefined {
  return loadMotions().find((motion) => motion.id === id);
}

/** 表現の既定。使う側で書き換えないよう、返すときは写しを作る */
export const DEFAULT_TREATMENT: Treatment = { surface: "none", motion: "none", motionSamples: [] };

// 既定の写し。motionSamples も新しい配列にする
function defaultTreatment(): Treatment {
  return { ...DEFAULT_TREATMENT, motionSamples: [] };
}

/** 既定の表現か (面も動きも指定せず、見本も選んでいない) */
export function isDefaultTreatment(t: Treatment): boolean {
  return t.surface === DEFAULT_TREATMENT.surface && t.motion === DEFAULT_TREATMENT.motion && t.motionSamples.length === 0;
}

// 表現の surface。省略は "none" で、面の台帳に無い id は入力の誤り
function surfaceOfTreatment(value: unknown): string {
  if (value === undefined) return DEFAULT_TREATMENT.surface;
  if (typeof value !== "string" || findSurface(value) === undefined) {
    throw inputError("treatment.surface は面の台帳の id で指定してください");
  }
  return value;
}

// 表現の motion。省略は "none" で、MOTION_LEVELS 以外は入力の誤り
function motionOfTreatment(value: unknown): MotionLevel {
  if (value === undefined) return DEFAULT_TREATMENT.motion;
  return oneOf(value, MOTION_LEVELS, "treatment.motion");
}

// 表現の motionSamples。省略は [] で、知らない見本・重複・5 件以上は入力の誤り
function samplesOfTreatment(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw inputError("treatment.motionSamples は配列で指定してください");
  if (value.length > SAMPLE_MAX) throw inputError(`treatment.motionSamples は ${SAMPLE_MAX} 件までで指定してください`);
  const samples = value.map((item, index) => sampleIdOf(item, index));
  if (new Set(samples).size !== samples.length) throw inputError("treatment.motionSamples に重複があります");
  return samples;
}

// 見本の id。動きの見本集に無い id は入力の誤り
function sampleIdOf(value: unknown, index: number): string {
  if (typeof value !== "string" || findMotion(value) === undefined) {
    throw inputError(`treatment.motionSamples[${index}] は動きの見本の id で指定してください`);
  }
  return value;
}

/** 外部入力の表現を検証する。undefined と null は既定の写し。motion が animated 以外なら motionSamples は [] に直す */
export function validateTreatment(x: unknown): Treatment {
  if (x === undefined || x === null) return defaultTreatment();
  if (!isRecord(x)) throw inputError("treatment はオブジェクトで指定してください");
  const surface = surfaceOfTreatment(x.surface);
  const motion = motionOfTreatment(x.motion);
  const motionSamples = samplesOfTreatment(x.motionSamples);
  return { surface, motion, motionSamples: motion === "animated" ? motionSamples : [] };
}

/** 会話の中で見られるよう、面の台帳と動きの見本集をまとめて返す */
export function treatmentListing(): { surfaces: SurfaceEntry[]; motions: MotionSample[] } {
  return { surfaces: loadSurfaces(), motions: loadMotions() };
}

export type SampleTheme = { themeId: string; mode: BaseMode; cssForPage: string; fontsUrl: string };

/** 動きの見本 1 件を、ページの殻 (pageHtml) に入れた 1 ファイルの HTML にする */
export function motionSampleHtml(sample: MotionSample, theme: SampleTheme): string {
  return pageHtml({
    title: sample.name,
    themeId: theme.themeId,
    mode: theme.mode,
    cssForPage: theme.cssForPage,
    fontsUrl: theme.fontsUrl,
    body: ['<main class="min-h-screen p-8">', sample.html, "</main>"].join("\n"),
    extraStyles: [{ id: "motion", css: sample.css }],
  });
}
