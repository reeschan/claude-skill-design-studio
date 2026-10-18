// ページ HTML の殻。骨組み・LLM のページ・見本帳で共通の形 (参照: 01M510GAC7MMH7RB6D594WSPVY)
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import type { BaseMode } from "./types.ts";

// 外部から読み込んでよいのは、Tailwind のブラウザ版と Google Fonts だけ
const TAILWIND_BROWSER_URL = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13";
const TAILWIND_PREFIX = TAILWIND_BROWSER_URL;
const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] as const;
// CSP の meta の content。値は参照の ref のとおり。読み込み先はブラウザ側でこれに縛る
export const PAGE_CSP = `default-src 'none'; script-src ${TAILWIND_BROWSER_URL}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'`;
// 相対参照を解決し、同じページ内の参照と外部の URL を区別する土台
const URL_BASE = "https://page.invalid/";

export const THEME_STYLE_TAG = '<style type="text/tailwindcss" id="theme">';

// HTML のタグ名は大文字小文字を区別しないので、</STYLE> や </Style > でも style は終わる
const END_STYLE_RE = /<\/style/i;
// HTML の文字参照。数値参照は 10 進と 16 進、名前付きは URL に悪用できるものを戻す
const ENTITY_RE = /&(?:#([0-9]+);?|#x([0-9a-f]+);?|([a-z]+);)/gi;
const ENTITY_NAMES: Record<string, string> = {
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  newline: "\n",
  quot: '"',
  sol: "/",
  tab: "\t",
};
const ATTR_RE = /\b(src|href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
// エスケープ内の空白や引用符は URL の区切りとして扱わない
const CSS_ESCAPE = String.raw`\\(?:[0-9a-f]{1,6}[ \t\r\n\f]?|[\s\S])`;
const CSS_STRING = `"((?:${CSS_ESCAPE}|[^"\\\\])*)"|'((?:${CSS_ESCAPE}|[^'\\\\])*)'`;
const CSS_URL_RE = new RegExp(`\\burl\\(\\s*(?:${CSS_STRING}|((?:${CSS_ESCAPE}|[^)'"\\s\\\\])*))\\s*\\)`, "gi");
const CSS_IMPORT_RE = new RegExp(`@import\\s*(?:${CSS_STRING})`, "gi");
const CSS_ESCAPE_RE = /\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|(\r\n|[\s\S]))/gi;

const REDUCED_MOTION_RE = /prefers-reduced-motion/i;
const MOTION_KEYFRAMES_RE = /@keyframes/i;
// animation / animation-* / transition / transition-* の宣言 (名前:) と、ベンダー接頭辞つきのもの
const MOTION_PROPERTY_RE = /(?:^|[;{\s])(?:-[a-z]+-)?(?:animation|transition)(?:-[a-z]+)*\s*:/i;
// 動きを調べる場所は style 要素の中身・style 属性・class 属性だけ。本文の文字は見ない
const STYLE_ELEMENT_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const MOTION_ATTR_RE = /\b(style|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
// テーマの style のあとに足す style の id。タグにそのまま入れるので形を限る
const EXTRA_STYLE_ID_RE = /^[a-z][a-z0-9-]*$/;

export type PageHtmlInput = {
  title: string;
  themeId: string;
  mode: BaseMode;
  cssForPage: string; // render --seed の css から先頭の @import "tailwindcss"; の行を除いたもの
  fontsUrl: string;
  body: string;
  extraStyles?: { id: string; css: string }[]; // テーマの style のあとに足す style。css が空のものは入れない
};

// 動きの点検の結果。ok は「動きが無い」か「reduced-motion の指定がある」
export type MotionCheck = { hasMotion: boolean; hasReducedMotion: boolean; ok: boolean };

/** 文字列を HTML に差し込める形にエスケープする */
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** 数値の文字参照を 1 文字にする。文字にならない値は置換文字にする (ブラウザと同じ扱い) */
function codePointChar(code: number): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(code);
}

/** HTML の文字参照を戻す。見つけた参照は 1 回だけ戻し、戻した結果を二重には戻さない */
function decodeHtmlEntities(value: string): string {
  return value.replace(ENTITY_RE, (match: string, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return codePointChar(Number(dec));
    if (hex !== undefined) return codePointChar(Number.parseInt(hex, 16));
    if (name !== undefined) return ENTITY_NAMES[name] ?? match;
    return match;
  });
}

/** CSS 内では HTML の文字参照を戻さず、CSS のエスケープだけを戻す */
function decodeCssEscapes(value: string): string {
  return value.replace(CSS_ESCAPE_RE, (_match: string, hex: string | undefined, char: string | undefined) => {
    if (hex !== undefined) return codePointChar(Number.parseInt(hex, 16));
    const text = char ?? "";
    return /^[\r\n\f]/.test(text) ? "" : text;
  });
}

/** すべての値を WHATWG URL で解決する。読み込みに関わらない data:・mailto:・tel: は許可し、読めない値も許可外として残す */
function disallowedUrl(value: string): string | null {
  try {
    const url = new URL(value, URL_BASE);
    if (url.origin === "https://page.invalid" || url.protocol === "data:" || url.protocol === "mailto:" || url.protocol === "tel:")
      return null;
    if (url.protocol === "https:" && isAllowedUrl(url.href)) return null;
    return url.href;
  } catch {
    return value;
  }
}

/** 解決後の href が許可した接頭辞に当たるか */
function isAllowedUrl(value: string): boolean {
  if (value.startsWith(TAILWIND_PREFIX)) return true;
  return FONT_ORIGINS.some((origin) => value.startsWith(`${origin}/`));
}

type UrlHit = { index: number; value: string };

// CSS の url() と @import の値を、HTML の文字参照を戻さずに集める
function collectCss(css: string, offset = 0): UrlHit[] {
  const hits: UrlHit[] = [];
  for (const pattern of [CSS_URL_RE, CSS_IMPORT_RE]) {
    for (const match of css.matchAll(pattern)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? "";
      const value = disallowedUrl(decodeCssEscapes(raw));
      if (value !== null) hits.push({ index: offset + match.index, value });
    }
  }
  return hits;
}

// style 属性は HTML の文字参照を 1 回戻してから CSS として読む。
// 処理済み属性は同じ長さの空白で覆い、CSS としての二重読みと位置のずれを防ぐ。
function collectUrls(html: string): UrlHit[] {
  const hits: UrlHit[] = [];
  const css = html.replace(
    ATTR_RE,
    (match: string, name: string, double: string | undefined, single: string | undefined, bare: string | undefined, index: number) => {
      const decoded = decodeHtmlEntities(double ?? single ?? bare ?? "");
      if (name.toLowerCase() === "style") {
        hits.push(...collectCss(decoded, index));
      } else {
        const value = disallowedUrl(decoded);
        if (value !== null) hits.push({ index, value });
      }
      return " ".repeat(match.length);
    },
  );
  return [...hits, ...collectCss(css)].sort((a, b) => a.index - b.index);
}

// 補助の lint。ブラウザと同じ解釈は完全には再現しない。読み込み先は PAGE_CSP で縛る
/** src=・href= と CSS の url(・@import に出てくる外部 URL のうち、許可していないものを出てきた順に (重複なく) 返す */
export function findDisallowedUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const hits = collectUrls(html);
  for (const hit of hits) {
    if (seen.has(hit.value)) continue;
    seen.add(hit.value);
    out.push(hit.value);
  }
  return out;
}

// 動きを調べる場所を集める。style 要素の中身は CSS として、style 属性の値も CSS として、
// class 属性の値は語に分けて持つ。class 属性の中の style 要素などは考えない補助の lint
function collectMotionSources(html: string): { css: string[]; classes: string[] } {
  const css: string[] = [];
  for (const match of html.matchAll(STYLE_ELEMENT_RE)) css.push(match[1] ?? "");
  const classes: string[] = [];
  for (const match of html.matchAll(MOTION_ATTR_RE)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if ((match[1] ?? "").toLowerCase() === "class") {
      classes.push(...value.split(/\s+/).filter((word) => word !== ""));
    } else {
      css.push(value);
    }
  }
  return { css, classes };
}

// class の語から hover: などの前置き (最後の : まで) を除いた部分
function classBase(word: string): string {
  const index = word.lastIndexOf(":");
  return index === -1 ? word : word.slice(index + 1);
}

// animate-* か transition / transition-* のユーティリティか
function isMotionClass(word: string): boolean {
  const base = classBase(word);
  return base.startsWith("animate-") || base === "transition" || base.startsWith("transition-");
}

function hasMotionCss(css: string): boolean {
  return MOTION_KEYFRAMES_RE.test(css) || MOTION_PROPERTY_RE.test(css);
}

function hasReducedMotionClass(classes: string[]): boolean {
  return classes.some((word) => word.includes("motion-safe:") || word.includes("motion-reduce:"));
}

// 補助の lint。完全な CSS の解釈はしない。動きには reduced-motion の指定を必ず置く (contract の 8 節)
/** ページの動きと reduced-motion の指定を調べる。本文の文字は見ず、style 要素・style 属性・class 属性だけを見る */
export function checkMotion(html: string): MotionCheck {
  const { css, classes } = collectMotionSources(html);
  const allCss = css.join("\n");
  const hasMotion = hasMotionCss(allCss) || classes.some(isMotionClass);
  const hasReducedMotion = REDUCED_MOTION_RE.test(allCss) || hasReducedMotionClass(classes);
  return { hasMotion, hasReducedMotion, ok: !hasMotion || hasReducedMotion };
}

// 属性つきの開始タグ。引用符の中の > では終わらない
const openTag = (name: string): string => `<${name}(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`;
const CHARSET_META = String.raw`<meta\s+charset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>` + "`" + String.raw`]+)\s*/?>`;
// 文書の先頭から CSP の meta の直前までに置けるのは、空白・doctype・html・head・meta charset だけ
// (コメントや script などが先にあると、CSP より先に動く・解釈されるので不可)。head の中で
// CSP の meta がほかの link・script・style より前にある条件も、これで満たされる
const PRE_CSP_RE = new RegExp(
  `^\\s*(?:<!doctype\\s+html\\s*>\\s*)?(${openTag("html")}\\s*)?(${openTag("head")})\\s*(?:${CHARSET_META}\\s*)*`,
  "i",
);
const META_OPEN_RE = /^<meta(?=[\s/>])/i;
// on で始まる属性 (onload= など)。タグの中の引用符つきの値に出てきても false 側に倒す
const EVENT_ATTR_RE = /[\s"'/]on[^\s"'=<>/]*\s*=/i;

// タグを属性の並びとして読むための、先頭固定 (sticky) の正規表現
const SKIP_RE = /[\s/]*/y;
const ATTR_NAME_RE = /[^\s/>][^\s/>=]*/y;
const EQUALS_RE = /\s*=\s*/y;
const QUOTED_RE = /"([^"]*)"|'([^']*)'/y;
const UNQUOTED_RE = /[^\s>]*/y;

function matchAt(re: RegExp, text: string, index: number): RegExpExecArray | null {
  re.lastIndex = index;
  return re.exec(text);
}

// 属性値 (二重引用符・単引用符・引用なし) を index から読む。引用符が閉じないときは null
function readAttrValue(text: string, index: number): { value: string; end: number } | null {
  if (text[index] === '"' || text[index] === "'") {
    const quoted = matchAt(QUOTED_RE, text, index);
    if (quoted === null) return null;
    return { value: quoted[1] ?? quoted[2] ?? "", end: index + quoted[0].length };
  }
  const bare = matchAt(UNQUOTED_RE, text, index);
  return { value: bare?.[0] ?? "", end: index + (bare?.[0].length ?? 0) };
}

// 属性 1 つ (名前と、あれば = と値) を index から読む。名前は小文字にする。引用符が閉じないときは null
function readAttr(text: string, index: number): { name: string; value: string; end: number } | null {
  const name = matchAt(ATTR_NAME_RE, text, index)?.[0] ?? "";
  const afterName = index + name.length;
  const equals = matchAt(EQUALS_RE, text, afterName);
  if (equals === null) return { name: name.toLowerCase(), value: "", end: afterName };
  const read = readAttrValue(text, afterName + equals[0].length);
  return read === null ? null : { name: name.toLowerCase(), value: read.value, end: read.end };
}

/**
 * `<meta` で始まる文字列の開始タグを、属性の並びとして先頭から 1 つずつ読む
 * (名前・`=`・二重引用符 / 単引用符 / 引用なしの値)。名前は小文字にし、同じ名前は最初のものだけ使う。
 * meta で始まらない・タグが閉じない (引用符が閉じない) ときは null
 */
function readMetaAttrs(text: string): Map<string, string> | null {
  if (!META_OPEN_RE.test(text)) return null;
  const attrs = new Map<string, string>();
  let i = "<meta".length;
  for (;;) {
    i += matchAt(SKIP_RE, text, i)?.[0].length ?? 0;
    if (i >= text.length) return null;
    if (text[i] === ">") return attrs;
    const attr = readAttr(text, i);
    if (attr === null) return null;
    if (!attrs.has(attr.name)) attrs.set(attr.name, attr.value);
    i = attr.end;
  }
}

// CSP の meta か。http-equiv は大文字小文字を問わず、content は PAGE_CSP と一致すること。
// 別の属性の値の中にある文字列には当たらない
function isCspMeta(text: string): boolean {
  const attrs = readMetaAttrs(text);
  return attrs !== null && attrs.get("http-equiv")?.toLowerCase() === "content-security-policy" && attrs.get("content") === PAGE_CSP;
}

/**
 * CSP の meta が PAGE_CSP そのままで、文書の中で最初に現れる要素側にあるか。
 * meta より前は空白・doctype・html・head・meta charset だけで、html・head に on 属性が無いこと
 */
export function hasPageCsp(html: string): boolean {
  const pre = PRE_CSP_RE.exec(html);
  if (pre === null) return false;
  if (EVENT_ATTR_RE.test(pre[1] ?? "") || EVENT_ATTR_RE.test(pre[2] ?? "")) return false;
  return isCspMeta(html.slice(pre[0].length));
}

/** 骨組み・LLM のページ・見本に共通の 1 ファイルの HTML を作る */
export function pageHtml(input: PageHtmlInput): string {
  if (END_STYLE_RE.test(input.cssForPage)) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: "cssForPage に </style は入れられません" });
  }
  return [
    "<!doctype html>",
    `<html lang="ja" data-theme="${escapeHtml(input.themeId)}" data-mode="${escapeHtml(input.mode)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${escapeHtml(input.fontsUrl)}" id="theme-fonts">`,
    `<script src="${TAILWIND_BROWSER_URL}"></script>`,
    THEME_STYLE_TAG,
    input.cssForPage,
    "</style>",
    ...extraStyleLines(input.extraStyles ?? []),
    "</head>",
    '<body class="bg-background font-sans text-foreground">',
    input.body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// テーマの style のあとに足す style を、行の並びにする。css が空のものは入れず、
// id の形と css に </style が無いことを確かめてから並べる
function extraStyleLines(styles: { id: string; css: string }[]): string[] {
  const lines: string[] = [];
  for (const style of styles) {
    if (style.css === "") continue;
    if (!EXTRA_STYLE_ID_RE.test(style.id)) {
      throw new CliExit(EXIT_INPUT, {
        error: "input",
        message: "extraStyles の id は英小文字で始まる英小文字・数字・ハイフンにしてください",
      });
    }
    if (END_STYLE_RE.test(style.css)) {
      throw new CliExit(EXIT_INPUT, { error: "input", message: "extraStyles の css に </style は入れられません" });
    }
    lines.push(`<style id="${style.id}">`, style.css, "</style>");
  }
  return lines;
}
