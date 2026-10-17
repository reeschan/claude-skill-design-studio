// 見本帳のスタイル。data/styles.json を読み、検証して返す。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { fileURLToPath } from "node:url";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import { LAYOUTS } from "./types.ts";
import type { BaseMode, Copy, Direction, FontMood, Layouts, Seed, ShadowKind, Style } from "./types.ts";

// core/styles.ts の 1 つ上 = リポジトリのルート
const DATA_FILE = fileURLToPath(new URL("../data/styles.json", import.meta.url));

const BASE_MODES: readonly BaseMode[] = ["light", "dark"];
const FONT_MOODS: readonly FontMood[] = ["geometric", "humanist", "rounded", "serif", "mincho", "tech"];
const SHADOWS: readonly ShadowKind[] = ["none", "soft", "hard"];

// Seed の制約。style-guide の core/validate-seed.ts と同じにする (ここが緩いと、入力の誤りが
// 子プロセスの input エラーになり、終了コードが 3 になってしまう)
const SEED_ID_RE = /^[a-z][a-z0-9-]*$/;
const SEED_ID_MAX = 20;
const HUE_MIN = 0;
const HUE_MAX = 360;
const RADIUS_MIN = 0;
const RADIUS_MAX = 48;
const SPACING_MIN = 0.5;
const SPACING_MAX = 2;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 空でない文字列
function str(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

// 有限の数値
function num(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw inputError(`${label} は数値で指定してください`);
  return value;
}

// min〜max に収まる数値
function numRange(value: unknown, min: number, max: number, label: string): number {
  const n = num(value, label);
  if (n < min || n > max) throw inputError(`${label} は ${min}〜${max} の範囲で指定してください`);
  return n;
}

// 0 以上 360 未満の色相 (style-guide の validate-seed.ts と同じ)
function hue(value: unknown, label: string): number {
  const n = num(value, label);
  if (n < HUE_MIN || n >= HUE_MAX) throw inputError(`${label} は ${HUE_MIN} 以上 ${HUE_MAX} 未満で指定してください`);
  return n;
}

// 色相または null。無いときは null にする
function nullableHue(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return hue(value, label);
}

// trim して空にならない文字列。前後の空白は落として返す
function seedStr(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value.trim();
}

// Seed の id。/^[a-z][a-z0-9-]*$/ に合う 20 文字以内 (style-guide の validate-seed.ts と同じ)
function seedId(value: unknown, label: string): string {
  const ok = typeof value === "string" && value.length <= SEED_ID_MAX && SEED_ID_RE.test(value);
  if (!ok) throw inputError(`${label} は /^[a-z][a-z0-9-]*$/ に合う ${SEED_ID_MAX} 文字以内の文字列で指定してください`);
  return value;
}

// 列挙のいずれか
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((a) => a === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

function validateSeed(x: unknown): Seed {
  if (!isRecord(x)) throw inputError("seed はオブジェクトで指定してください");
  const { color, shape, font } = x;
  if (!isRecord(color)) throw inputError("seed.color はオブジェクトで指定してください");
  if (!isRecord(shape)) throw inputError("seed.shape はオブジェクトで指定してください");
  if (!isRecord(font)) throw inputError("seed.font はオブジェクトで指定してください");
  const pairId = font.pairId === undefined ? undefined : seedStr(font.pairId, "seed.font.pairId");
  return {
    id: seedId(x.id, "seed.id"),
    name: seedStr(x.name, "seed.name"),
    tone: seedStr(x.tone, "seed.tone"),
    baseMode: oneOf(x.baseMode, BASE_MODES, "seed.baseMode"),
    color: {
      brandHue: hue(color.brandHue, "seed.color.brandHue"),
      brandChroma: numRange(color.brandChroma, 0, 0.4, "seed.color.brandChroma"),
      accentHue: nullableHue(color.accentHue, "seed.color.accentHue"),
      neutralHue: hue(color.neutralHue, "seed.color.neutralHue"),
      neutralChroma: numRange(color.neutralChroma, 0, 0.4, "seed.color.neutralChroma"),
      contrast: numRange(color.contrast, 1, 5, "seed.color.contrast"),
    },
    shape: {
      radiusPx: numRange(shape.radiusPx, RADIUS_MIN, RADIUS_MAX, "seed.shape.radiusPx"),
      spacingScale: numRange(shape.spacingScale, SPACING_MIN, SPACING_MAX, "seed.shape.spacingScale"),
      shadow: oneOf(shape.shadow, SHADOWS, "seed.shape.shadow"),
    },
    font: {
      mood: oneOf(font.mood, FONT_MOODS, "seed.font.mood"),
      heading: seedStr(font.heading, "seed.font.heading"),
      body: seedStr(font.body, "seed.font.body"),
      mono: seedStr(font.mono, "seed.font.mono"),
      ...(pairId === undefined ? {} : { pairId }),
    },
  };
}

// 骨組みの種類ごとの配置の型。キーが無い種類だけ先頭の配置の型で埋める (前の形の styles.json を読めるように)。
// キーがあるものは今どおり確かめ、null や知らない値は入力の誤りにする
function validateLayouts(x: unknown): Layouts {
  if (!isRecord(x)) throw inputError("layouts はオブジェクトで指定してください");
  return {
    lp: Object.hasOwn(x, "lp") ? oneOf(x.lp, LAYOUTS.lp, "layouts.lp") : LAYOUTS.lp[0],
    dashboard: Object.hasOwn(x, "dashboard") ? oneOf(x.dashboard, LAYOUTS.dashboard, "layouts.dashboard") : LAYOUTS.dashboard[0],
    blog: Object.hasOwn(x, "blog") ? oneOf(x.blog, LAYOUTS.blog, "layouts.blog") : LAYOUTS.blog[0],
    pricing: Object.hasOwn(x, "pricing") ? oneOf(x.pricing, LAYOUTS.pricing, "layouts.pricing") : LAYOUTS.pricing[0],
    product: Object.hasOwn(x, "product") ? oneOf(x.product, LAYOUTS.product, "layouts.product") : LAYOUTS.product[0],
    portfolio: Object.hasOwn(x, "portfolio") ? oneOf(x.portfolio, LAYOUTS.portfolio, "layouts.portfolio") : LAYOUTS.portfolio[0],
    settings: Object.hasOwn(x, "settings") ? oneOf(x.settings, LAYOUTS.settings, "layouts.settings") : LAYOUTS.settings[0],
  };
}

function validateCopyItem(x: unknown, index: number): { title: string; body: string } {
  if (!isRecord(x)) throw inputError(`copy.items[${index}] はオブジェクトで指定してください`);
  return { title: str(x.title, `copy.items[${index}].title`), body: str(x.body, `copy.items[${index}].body`) };
}

function validateCopy(x: unknown): Copy {
  if (!isRecord(x)) throw inputError("copy はオブジェクトで指定してください");
  const { items } = x;
  if (!Array.isArray(items) || items.length < 3 || items.length > 6) {
    throw inputError("copy.items は 3〜6 件の配列で指定してください");
  }
  return {
    brand: str(x.brand, "copy.brand"),
    tagline: str(x.tagline, "copy.tagline"),
    headline: str(x.headline, "copy.headline"),
    lead: str(x.lead, "copy.lead"),
    cta: str(x.cta, "copy.cta"),
    items: items.map((item, index) => validateCopyItem(item, index)),
  };
}

/** Direction を検証する。Style は Direction に description を足したものなので、そのまま渡せる */
export function validateDirection(x: unknown): Direction {
  if (!isRecord(x)) throw inputError("direction はオブジェクトで指定してください");
  return {
    id: str(x.id, "id"),
    name: str(x.name, "name"),
    rationale: str(x.rationale, "rationale"),
    seed: validateSeed(x.seed),
    layouts: validateLayouts(x.layouts),
    copy: validateCopy(x.copy),
  };
}

// Style は Direction に description を足したもの。id は seed.id と同じにする
function validateStyle(x: unknown, index: number): Style {
  const direction = validateDirection(x);
  const description = isRecord(x) ? x.description : undefined;
  if (typeof description !== "string" || description === "") {
    throw inputError(`styles[${index}] (${direction.id}) の description は空でない文字列で指定してください`);
  }
  if (direction.seed.id !== direction.id) {
    throw inputError(`styles[${index}] (${direction.id}) の seed.id は id と同じにしてください`);
  }
  return { ...direction, description };
}

/** data/styles.json を読み、検証して返す */
export function loadStyles(): Style[] {
  const raw = readJsonFile(DATA_FILE, "styles");
  if (!Array.isArray(raw)) throw inputError("data/styles.json は Style の配列で指定してください");
  const styles = raw.map((x, index) => validateStyle(x, index));
  if (new Set(styles.map((s) => s.id)).size !== styles.length) {
    throw inputError("data/styles.json の id が重複しています");
  }
  return styles;
}

/** id に一致するスタイル。無ければ undefined */
export function findStyle(id: string): Style | undefined {
  return loadStyles().find((s) => s.id === id);
}
