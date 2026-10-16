// ページ HTML の殻。骨組み・LLM のページ・見本帳で共通の形 (参照: 01M4ZAMCSN57HMR5T5XYTY062V)
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import type { BaseMode } from "./types.ts";

// 外部から読み込んでよいのは、Tailwind のブラウザ版と Google Fonts だけ
const TAILWIND_BROWSER_URL = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13";
const TAILWIND_PREFIX = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] as const;
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

export type PageHtmlInput = {
  title: string;
  themeId: string;
  mode: BaseMode;
  cssForPage: string; // render --seed の css から先頭の @import "tailwindcss"; の行を除いたもの
  fontsUrl: string;
  body: string;
};

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

/** すべての値を WHATWG URL で解決する。読めない値も許可外として残す */
function disallowedUrl(value: string): string | null {
  try {
    const url = new URL(value, URL_BASE);
    if (url.origin === "https://page.invalid" || url.protocol === "data:") return null;
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
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${escapeHtml(input.fontsUrl)}" id="theme-fonts">`,
    `<script src="${TAILWIND_BROWSER_URL}"></script>`,
    THEME_STYLE_TAG,
    input.cssForPage,
    "</style>",
    "</head>",
    '<body class="bg-background font-sans text-foreground">',
    input.body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
