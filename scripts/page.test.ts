// ページの殻 (core/page-html.ts)・骨組みの表 (skeletons/index.ts)・check-page を外から確かめる
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { escapeHtml, findDisallowedUrls } from "../core/page-html.ts";
import { LAYOUTS, PAGE_TYPES } from "../core/types.ts";
import type { BaseMode, Copy, PageType } from "../core/types.ts";
import { SKELETONS, renderSkeleton } from "../skeletons/index.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const COPY: Copy = {
  brand: "かたどり工房",
  tagline: "かたちを、ためす",
  headline: "ためしの見出し",
  lead: "説明のための短い文章です。",
  cta: "はじめる",
  items: [
    { title: "項目その一", body: "一つめの説明です。" },
    { title: "項目その二", body: "二つめの説明です。" },
    { title: "項目その三", body: "三つめの説明です。" },
  ],
};

const MODE: BaseMode = "light";
const THEME_ID = "sample-theme";
const TITLE = "ためしのページ";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap";
const CSS_FOR_PAGE = "@theme { --color-primary: oklch(0.5 0.15 260); }";
const TAILWIND_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13"></script>';
const THEME_STYLE = '<style type="text/tailwindcss" id="theme">';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

function render(pageType: PageType, layout: string, title = TITLE): string {
  return renderSkeleton({
    pageType,
    layout,
    copy: COPY,
    mode: MODE,
    themeId: THEME_ID,
    cssForPage: CSS_FOR_PAGE,
    fontsUrl: FONTS_URL,
    title,
  });
}

void test("9 つの骨組みが殻どおりの 1 ファイルを返す", () => {
  for (const pageType of PAGE_TYPES) {
    for (const layout of LAYOUTS[pageType]) {
      const label = `${pageType}/${layout}`;
      const html = render(pageType, layout);
      assert.ok(html.startsWith("<!doctype html>"), `${label}: <!doctype html> で始まる`);
      assert.ok(html.includes(`data-theme="${THEME_ID}"`), `${label}: data-theme`);
      assert.ok(html.includes(`data-mode="${MODE}"`), `${label}: data-mode`);
      assert.ok(html.includes(TAILWIND_SCRIPT), `${label}: Tailwind のブラウザ版`);
      assert.ok(html.includes(THEME_STYLE), `${label}: id="theme" の style`);
      assert.ok(html.includes(COPY.headline), `${label}: copy.headline`);
      assert.deepEqual(findDisallowedUrls(html), [], `${label}: 許可していない読み込み`);
    }
  }
});

void test("LP の 3 つは互いに異なる body を返し、items の題名をすべて含む", () => {
  const bodies = LAYOUTS.lp.map((layout) => SKELETONS.lp[layout]({ copy: COPY, mode: MODE }));
  assert.equal(new Set(bodies).size, 3);
  for (const body of bodies) {
    for (const item of COPY.items) {
      assert.ok(body.includes(item.title), `${item.title} を含む`);
    }
  }
});

void test("findDisallowedUrls は許可していない読み込みだけを出てきた順に返す", () => {
  const html = [
    '<img src="https://example.com/a.png">',
    "div { background-image: url(https://x.test/b.png); }",
    '<script src="https://cdn.example.com/x.js"></script>',
  ].join("\n");
  assert.deepEqual(findDisallowedUrls(html), ["https://example.com/a.png", "https://x.test/b.png", "https://cdn.example.com/x.js"]);
});

void test("findDisallowedUrls は空白・文字参照を整え、外部 URL を解決してから判定する", () => {
  const cases: { label: string; html: string; urls: string[] }[] = [
    { label: "前の空白", html: '<script src=" https://cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "前の改行", html: '<script src="\nhttps://cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "後ろの空白", html: '<script src="https://cdn.example.com/x.js "></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "数値参照", html: '<script src="https&#58;//cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "16 進の数値参照", html: '<script src="https&#x3a;//cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "名前付き参照", html: '<script src="https&colon;//cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    {
      label: "スラッシュの名前付き参照",
      html: '<script src="https:&sol;&sol;cdn.example.com/x.js"></script>',
      urls: ["https://cdn.example.com/x.js"],
    },
    { label: "空白なしの @import", html: '@import"https://x.test/c.css";', urls: ["https://x.test/c.css"] },
    { label: "プロトコル相対 (属性)", html: '<script src="//cdn.example.com/x.js"></script>', urls: ["https://cdn.example.com/x.js"] },
    { label: "プロトコル相対 (CSS)", html: "a { background-image: url(//x.test/b.png); }", urls: ["https://x.test/b.png"] },
    {
      label: "許可した接頭辞のあとの ..",
      html: '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4/../../../gh/evil/repo/x.js"></script>',
      urls: ["https://cdn.jsdelivr.net/gh/evil/repo/x.js"],
    },
  ];
  for (const c of cases) {
    assert.deepEqual(findDisallowedUrls(c.html), c.urls, c.label);
  }
});

void test("findDisallowedUrls は CSS と HTML 属性の復号を分ける", () => {
  // CSS では &sol; を戻さないので、fonts.googleapis.com&sol%3B がユーザー情報、evil.example がホストになる
  const entityUrl = "https://fonts.googleapis.com&sol;@evil.example/x.css";
  const resolved = "https://fonts.googleapis.com&sol%3B@evil.example/x.css";
  assert.deepEqual(findDisallowedUrls(`<style>@import "${entityUrl}";</style>`), [resolved]);
  assert.deepEqual(findDisallowedUrls(`<style>a { background: url('${entityUrl}'); }</style>`), [resolved]);
  // style 属性は属性値として 1 回戻してから CSS として読むので、&sol; は / になる
  assert.deepEqual(findDisallowedUrls(`<div style="background: url('${entityUrl}')"></div>`), []);
  assert.deepEqual(findDisallowedUrls('<div style="background: url(&quot;https://x.test/b.png&quot;)"></div>'), ["https://x.test/b.png"]);
  assert.deepEqual(findDisallowedUrls('<div style="background: url(https://fonts.googleapis.com&amp;sol;@evil.example/x.css)"></div>'), [
    resolved,
  ]);
  // 大文字の名前付き参照は戻さない
  const upperEntityUrl = "https://fonts.googleapis.com&SOL;@evil.example/x.css";
  assert.deepEqual(findDisallowedUrls(`<link href="${upperEntityUrl}">`), ["https://fonts.googleapis.com&SOL%3B@evil.example/x.css"]);
  for (const value of [
    "https&#58//x.test/b.png",
    "https&#x3a//x.test/b.png",
    "ht&tab;tps://x.test/b.png",
    "ht&newline;tps://x.test/b.png",
  ]) {
    assert.deepEqual(findDisallowedUrls(`<img src="${value}">`), ["https://x.test/b.png"]);
  }
});

void test("findDisallowedUrls は全値を WHATWG URL で解決して判定する", () => {
  const values = [
    String.raw`\\cdn.example.com\x.js`,
    String.raw`https:\\cdn.example.com\x.js`,
    "ht&#10;tps://cdn.example.com/x.js",
    "/\n/cdn.example.com/x.js",
    "\u0001ht\ttps:\r//cdn.example.com/x.js\u001f",
  ];
  for (const value of values) {
    assert.deepEqual(findDisallowedUrls(`<script src="${value}"></script>`), ["https://cdn.example.com/x.js"], value);
  }
  for (const value of ["http://fonts.googleapis.com/x.css", "javascript:alert(1)", "ftp://x.test/a", "https://[broken"]) {
    assert.deepEqual(findDisallowedUrls(`<a href="${value}">リンク</a>`), [value], value);
  }
});

void test("findDisallowedUrls は CSS の 16 進と 1 文字のエスケープを戻す", () => {
  const cases = [
    String.raw`<style>a { background: url(https:\2f\2f x.test/b.png); }</style>`,
    String.raw`<style>@import "https:\00002f\2f x.test/b.png";</style>`,
    String.raw`<style>@import url('https:\/\/x.test/b.png');</style>`,
    String.raw`<div style="background: url(https:\2f\2f x.test/b.png)"></div>`,
  ];
  for (const html of cases) {
    assert.deepEqual(findDisallowedUrls(html), ["https://x.test/b.png"], html);
  }
});

void test("findDisallowedUrls は同一ページの参照と data URL を許可する", () => {
  for (const value of ["#top", "./a.html", "data:image/svg+xml,%3Csvg%3E%3C/svg%3E"]) {
    assert.deepEqual(findDisallowedUrls(`<a href="${value}"></a><img src="${value}">`), [], value);
  }
});

void test("findDisallowedUrls は Google Fonts と Tailwind のブラウザ版を返さない", () => {
  const html = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_URL}" id="theme-fonts">`,
    TAILWIND_SCRIPT,
    '<link rel="stylesheet" href=" https://fonts.googleapis.com/css2?family=A">',
    '@import"https://fonts.googleapis.com/css2?family=A&amp;display=swap";',
    "a { background-image: url(//fonts.gstatic.com/s/noto/v1/x.woff2); }",
  ].join("\n");
  assert.deepEqual(findDisallowedUrls(html), []);
});

void test("title に <script> を渡してもエスケープされる", () => {
  const raw = '<script>alert("x")</script>';
  const escaped = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;";
  assert.equal(escapeHtml(raw), escaped);
  const html = render("lp", "centered", raw);
  assert.ok(html.includes(escaped));
  assert.ok(!html.includes("<script>alert"));
});

void test("cssForPage の </style は大文字小文字を問わず止まる", () => {
  for (const cssForPage of ["a</style>b", "a</STYLE><script>alert(1)</script>", "a</Style >b"]) {
    assert.throws(
      () =>
        renderSkeleton({
          pageType: "lp",
          layout: "centered",
          copy: COPY,
          mode: MODE,
          themeId: THEME_ID,
          cssForPage,
          fontsUrl: FONTS_URL,
          title: TITLE,
        }),
      `${cssForPage} で止まる`,
    );
  }
});

void test("check-page は許可外を含むファイルを ok: false、殻どおりのファイルを ok: true にする", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const goodPath = join(dir, "good.html");
    writeFileSync(goodPath, render("lp", "centered"), "utf8");
    const badPath = join(dir, "bad.html");
    writeFileSync(badPath, render("lp", "centered").replace("</body>", '<img src="https://example.com/a.png"></body>'), "utf8");

    const goodRes = runCli(["check-page", "--html", goodPath], env);
    const good = payload(goodRes.json);
    assert.equal(good.ok, true);
    assert.equal(good.themeId, THEME_ID);
    assert.equal(good.hasThemeStyle, true);
    assert.deepEqual(good.disallowed, []);

    const bad = payload(runCli(["check-page", "--html", badPath], env).json);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.disallowed, ["https://example.com/a.png"]);

    const missing = runCli(["check-page", "--html", join(dir, "nothing.html")], env);
    assert.equal(missing.code, 1);
    assert.equal(payload(missing.json).error, "file");
  } finally {
    cleanup();
  }
});
