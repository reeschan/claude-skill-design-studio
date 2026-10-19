// 背景スケッチの入力の検証と、テーマの css から色付けの 3 色を取り出す処理、
// 焼き込んだ画像をページへ差し込む処理。外部入力の検証は core/treatment.ts に倣って手で書く
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { hasPageCsp } from "./page-html.ts";
import { SKETCH_MOTIONS, SKETCH_PLACEMENTS, SKETCH_SOURCES } from "./types.ts";
import type { BackgroundApply, BackgroundSketch, BaseMode, Rgb, SketchPalette, SketchSource } from "./types.ts";

export const SKETCH_CODE_MAX = 8000;
export const BACKGROUND_STYLE_ID = "background-sketch";
export const BACKGROUND_IMAGE_MAX = 600 * 1024;

const IMAGE_PREFIX = "data:image/webp;base64,";
const IMAGE_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// 差し込んだ style を取り除く。直後の改行 1 つも一緒に消し、差し込む前の文字列に戻す
const BACKGROUND_STYLE_RE = /<style\b[^>]*\bid\s*=\s*"background-sketch"[^>]*>[\s\S]*?<\/style>\n?/gi;
const META_TAG_RE = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const CSP_HTTP_EQUIV_RE = /http-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy)/i;
const BODY_TAG_RE = /<body\b/i;
const HERO_ATTR_RE = /\sdata-hero(?=[\s=>/])/i;

const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
const OKLCH_PARAM_RE = /^\s*([0-9]*\.?[0-9]+)(%?)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)/;
const DATA_THEME_RE = /\[data-theme\b/i;
const DATA_MODE_RE = /\[data-mode\b/i;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 列挙のいずれか
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

// sampleId は source が sample のときだけ文字列、ほかは null
function sampleIdOf(source: SketchSource, value: unknown): string | null {
  if (source === "sample") {
    if (typeof value !== "string") throw inputError("background.sampleId は source が sample のとき文字列で指定してください");
    return value;
  }
  if (value !== null) throw inputError("background.sampleId は source が sample 以外のとき null で指定してください");
  return null;
}

// code は 1〜SKETCH_CODE_MAX 文字
function codeOf(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > SKETCH_CODE_MAX) {
    throw inputError(`background.code は 1〜${SKETCH_CODE_MAX} 文字で指定してください`);
  }
  return value;
}

/** 外部入力の背景スケッチを検証する。undefined と null は null */
export function validateBackgroundSketch(value: unknown): BackgroundSketch | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw inputError("background はオブジェクトで指定してください");
  const source = oneOf(value.source, SKETCH_SOURCES, "background.source");
  const sampleId = sampleIdOf(source, value.sampleId);
  const code = codeOf(value.code);
  const placement = oneOf(value.placement, SKETCH_PLACEMENTS, "background.placement");
  const motion = oneOf(value.motion, SKETCH_MOTIONS, "background.motion");
  return { source, sampleId, code, placement, motion };
}

// data:image/webp;base64, で始まり、残りが base64 の文字だけで、長さが上限以下
function isWebpDataUrl(value: string): boolean {
  return value.startsWith(IMAGE_PREFIX) && IMAGE_BODY_RE.test(value.slice(IMAGE_PREFIX.length));
}

// 差し込む画像の data URL
function imageOf(value: unknown): string {
  if (typeof value !== "string" || value.length > BACKGROUND_IMAGE_MAX || !isWebpDataUrl(value)) {
    throw inputError(`background.image は ${BACKGROUND_IMAGE_MAX} 文字以下の data:image/webp;base64, の data URL で指定してください`);
  }
  return value;
}

/** 外部入力の差し込みの指定を検証する */
export function validateBackgroundApply(value: unknown): BackgroundApply {
  if (!isRecord(value)) throw inputError("background はオブジェクトで指定してください");
  return {
    image: imageOf(value.image),
    placement: oneOf(value.placement, SKETCH_PLACEMENTS, "background.placement"),
    motion: oneOf(value.motion, SKETCH_MOTIONS, "background.motion"),
  };
}

type FoundColors = { background: Rgb | null; primary: Rgb | null; accent: Rgb | null };
type CssBlock = { selector: string; body: string };

// テーマの css を、セレクターと宣言の組に分ける (テーマの css は入れ子を持たない)
function cssBlocks(css: string): CssBlock[] {
  return [...css.matchAll(CSS_RULE_RE)].map((match) => ({ selector: match[1] ?? "", body: match[2] ?? "" }));
}

// ブロックの中の --<name>: oklch(...) を sRGB にする。無ければ null
function colorOf(body: string, name: string): Rgb | null {
  const match = new RegExp(`(?<![\\w-])--${name}\\s*:\\s*oklch\\(([^)]*)\\)`, "i").exec(body);
  if (match === null) return null;
  return rgbOfOklch(match[1] ?? "");
}

// oklch(L C H) の引数。L は 0.5 でも 50% でも読む
function rgbOfOklch(params: string): Rgb | null {
  const match = OKLCH_PARAM_RE.exec(params);
  if (match === null) return null;
  const [, rawLightness = "", percent = "", rawChroma = "", rawHue = ""] = match;
  const lightness = Number.parseFloat(rawLightness) / (percent === "%" ? 100 : 1);
  return oklchToRgb(lightness, Number.parseFloat(rawChroma), Number.parseFloat(rawHue));
}

// OKLCH → OKLab → LMS' → 線形 sRGB → ガンマ → 0〜255 の整数
function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return [
    channelOf(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channelOf(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channelOf(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// 線形 sRGB をガンマ補正し、0〜1 に切って 0〜255 の整数にする
function channelOf(linear: number): number {
  const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
}

// ブロックに書かれた色で見つかった色を上書きする
function overlayColors(found: FoundColors, body: string): void {
  found.background = colorOf(body, "background") ?? found.background;
  found.primary = colorOf(body, "primary") ?? found.primary;
  found.accent = colorOf(body, "brand-accent") ?? found.accent;
}

// data-mode の無い [data-theme=…] のブロック
function isBaseSelector(selector: string): boolean {
  return DATA_THEME_RE.test(selector) && !DATA_MODE_RE.test(selector);
}

// 指定したモードの [data-mode=…] を含むブロック
function isModeSelector(selector: string, mode: BaseMode): boolean {
  return new RegExp(`\\[data-mode\\s*=\\s*["']?${mode}["']?\\s*\\]`, "i").test(selector);
}

/**
 * テーマの css から --background・--primary・--brand-accent の oklch を読み、sRGB の整数にする。
 * data-mode の無いブロックを読んだあと、指定したモードのブロックで上書きする
 */
export function sketchPaletteOf(css: string, mode: BaseMode): SketchPalette {
  const blocks = cssBlocks(css);
  const found: FoundColors = { background: null, primary: null, accent: null };
  for (const block of blocks) if (isBaseSelector(block.selector)) overlayColors(found, block.body);
  for (const block of blocks) if (isModeSelector(block.selector, mode)) overlayColors(found, block.body);
  return paletteOf(found);
}

// 見つかった色に既定を当てはめる。どれも無ければ 3 色とも既定にする
function paletteOf(found: FoundColors): SketchPalette {
  if (found.background === null && found.primary === null && found.accent === null) {
    return { background: [0, 0, 0], primary: [128, 128, 128], accent: [255, 255, 255] };
  }
  const background: Rgb = found.background ?? [0, 0, 0];
  const primary: Rgb = found.primary ?? [128, 128, 128];
  return { background, primary, accent: found.accent ?? primary };
}

// 本文 (body 以降) に data-hero 属性があるか。値の有無は問わない
function hasHeroMark(html: string): boolean {
  const body = BODY_TAG_RE.exec(html);
  return body !== null && HERO_ATTR_RE.test(html.slice(body.index));
}

// CSP の meta の終わりの位置。hasPageCsp が true の html では必ず見つかる
function cspMetaEnd(html: string): number {
  for (const match of html.matchAll(META_TAG_RE)) {
    if (CSP_HTTP_EQUIV_RE.test(match[0])) return (match.index ?? 0) + match[0].length;
  }
  throw inputError("CSP の meta の無いページには背景を差し込めません");
}

// 差し込む style の中身。hero の目印があればその要素、無ければ body に当てる
function backgroundStyle(html: string, apply: BackgroundApply): string {
  const selector = apply.placement === "hero" && hasHeroMark(html) ? "[data-hero]" : "body";
  const position = selector === "body" ? "fixed" : "absolute";
  const rules = [
    `${selector}{position:relative;isolation:isolate}`,
    `${selector}::before{content:"";position:${position};inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(color-mix(in oklch,var(--background) 40%,transparent),color-mix(in oklch,var(--background) 40%,transparent)),url("${apply.image}");background-size:cover;background-position:center}`,
  ];
  if (apply.motion === "slow") {
    rules.push(
      `${selector}::before{inset:-6%;animation:background-sketch-drift 48s ease-in-out infinite alternate}`,
      "@keyframes background-sketch-drift{from{transform:translate3d(-3%,-2%,0)}to{transform:translate3d(3%,2%,0)}}",
      `@media (prefers-reduced-motion: reduce){${selector}::before{animation:none}}`,
    );
  }
  return `<style id="${BACKGROUND_STYLE_ID}">${rules.join("\n")}</style>`;
}

/** 焼き込んだ画像をページに差し込む。何度呼んでも style は 1 つ。apply が null なら取り除くだけ */
export function applyBackground(html: string, apply: BackgroundApply | null): string {
  const base = html.replace(BACKGROUND_STYLE_RE, "");
  if (apply === null) return base;
  if (!hasPageCsp(base)) throw inputError("CSP の meta の無いページには背景を差し込めません");
  const end = cspMetaEnd(base);
  return `${base.slice(0, end)}\n${backgroundStyle(base, apply)}${base.slice(end)}`;
}
