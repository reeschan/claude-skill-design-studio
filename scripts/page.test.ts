// ページの殻 (core/page-html.ts)・骨組みの表 (skeletons/index.ts)・check-page を外から確かめる
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "../core/cli-exit.ts";
import { PAGE_CSP, escapeHtml, findDisallowedUrls, hasPageCsp, pageHtml } from "../core/page-html.ts";
import { LAYOUTS } from "../core/types.ts";
import type { BaseMode, Copy, SkeletonFamily } from "../core/types.ts";
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

// このテストが見る骨組み (元の 3 種類)。7 種類すべては scripts/skeletons-all.test.ts が見る
const FAMILIES: readonly SkeletonFamily[] = ["lp", "dashboard", "blog"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

function render(family: SkeletonFamily, layout: string, title = TITLE): string {
  return renderSkeleton({
    family,
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
  for (const family of FAMILIES) {
    for (const layout of LAYOUTS[family]) {
      const label = `${family}/${layout}`;
      const html = render(family, layout);
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
          family: "lp",
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
    assert.equal(good.hasCsp, true);
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

void test("PAGE_CSP は参照の値そのまま", () => {
  assert.equal(
    PAGE_CSP,
    "default-src 'none'; script-src https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'",
  );
});

void test("9 つの骨組みは CSP の meta をほかの link・script・style より前に持つ", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
  for (const family of FAMILIES) {
    for (const layout of LAYOUTS[family]) {
      const label = `${family}/${layout}`;
      const html = render(family, layout);
      assert.ok(html.includes(meta), `${label}: 値そのままの CSP の meta`);
      assert.ok(hasPageCsp(html), `${label}: hasPageCsp`);
    }
  }
});

void test("hasPageCsp は CSP の meta より前にあるインラインの script・コメント・on 属性を false にする", () => {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
  const script = '<script>fetch(location.origin+"/api/projects")</script>';
  const good = `<!doctype html><html lang="ja"><head><meta charset="utf-8">${cspMeta}</head><body>x</body></html>`;
  assert.equal(hasPageCsp(good), true, "good");
  assert.equal(hasPageCsp(`  \n${good}`), true, "先頭の空白");
  assert.equal(
    hasPageCsp(`<!DOCTYPE html>\n<HTML lang="ja">\n<HEAD>\n<META CHARSET="utf-8">\n${cspMeta}\n</HEAD><body></body></HTML>`),
    true,
    "大文字",
  );
  assert.equal(hasPageCsp(`<html lang="ja" data-x=">"><head>${cspMeta}</head></html>`), true, "引用符の中の >");
  const reversed = `<meta content="${PAGE_CSP}" http-equiv="Content-Security-Policy">`;
  assert.equal(hasPageCsp(`<!doctype html><html><head><meta charset="utf-8">${reversed}</head></html>`), true, "content が先");
  assert.equal(
    hasPageCsp(`<!doctype html><html><head><meta data-a='>' content="${PAGE_CSP}" HTTP-EQUIV=content-security-policy></head></html>`),
    true,
    "単引用符・引用なし・値の中の >",
  );

  const cases = [
    { label: "head より前の script", html: `<!doctype html><html lang="ja">${script}<head><meta charset="utf-8">${cspMeta}</head></html>` },
    { label: "doctype より前の script", html: `${script}<!doctype html><html><head>${cspMeta}</head></html>` },
    { label: "html と head のあいだの script", html: `<!doctype html><html lang="ja">${script}<head>${cspMeta}</head></html>` },
    { label: "html を省いた head より前の script", html: `<!doctype html>${script}<head>${cspMeta}</head>` },
    { label: "CSP の meta より前のコメント", html: `<!doctype html><html><head><!-- x -->${cspMeta}</head></html>` },
    { label: "doctype より前のコメント", html: `<!-- x --><!doctype html><html><head>${cspMeta}</head></html>` },
    { label: "head の中の CSP より前の script", html: `<!doctype html><html><head>${script}${cspMeta}</head></html>` },
    { label: "CSP より前の別の meta", html: `<!doctype html><html><head><meta name="x" content="y">${cspMeta}</head></html>` },
    { label: "html の onload", html: `<!doctype html><html lang="ja" onload="alert(1)"><head>${cspMeta}</head></html>` },
    { label: "html の onload (引用符なし・スラッシュ区切り)", html: `<!doctype html><html/onload=alert(1)><head>${cspMeta}</head></html>` },
    { label: "head の onload", html: `<!doctype html><html><head ONLOAD='alert(1)'>${cspMeta}</head></html>` },
    {
      label: "別の属性 (単引用符) の値の中に CSP の meta の文字列",
      html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name='x http-equiv="Content-Security-Policy" content="${PAGE_CSP}"'><script>fetch("/api/projects")</script></head><body>x</body></html>`,
    },
    {
      label: "content が別の属性の値の中にしか無い",
      html: `<!doctype html><html><head><meta name="x" data-a='content="${PAGE_CSP}"' http-equiv="Content-Security-Policy"></head></html>`,
    },
    {
      label: "引用符が閉じないタグ",
      html: `<!doctype html><html><head><meta data-a="x http-equiv=content-security-policy content=${PAGE_CSP}></head></html>`,
    },
    {
      label: "同じ名前の属性は最初が有効 (content)",
      html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *" content="${PAGE_CSP}"></head></html>`,
    },
    { label: "head が無い", html: `<!doctype html><html>${cspMeta}</html>` },
    { label: "CSP の meta が無い", html: '<!doctype html><html><head><meta charset="utf-8"></head></html>' },
  ];
  for (const c of cases) assert.equal(hasPageCsp(c.html), false, c.label);
});

void test("findDisallowedUrls は mailto: と tel: を返さず、javascript: と http: を返す", () => {
  assert.deepEqual(findDisallowedUrls('<a href="mailto:a@example.com">メール</a>'), []);
  assert.deepEqual(findDisallowedUrls('<a href="tel:0312345678">電話</a>'), []);
  assert.deepEqual(findDisallowedUrls('<a href="javascript:void(0)">x</a>'), ["javascript:void(0)"]);
  assert.deepEqual(findDisallowedUrls('<a href="http://example.com/x">x</a>'), ["http://example.com/x"]);
});

void test("check-page は CSP の meta が無い・値が違う・link より後ろのファイルを ok: false にする", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
    const goodHtml = render("lp", "centered");
    const missing = goodHtml.replace(cspMeta, "");
    const wrong = goodHtml.replace(PAGE_CSP, "default-src 'self'");
    const afterLink = missing.replace(
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      `<link rel="preconnect" href="https://fonts.googleapis.com">\n${cspMeta}`,
    );
    const cases = [
      { label: "csp-missing", html: missing },
      { label: "csp-wrong", html: wrong },
      { label: "csp-after-link", html: afterLink },
    ];
    for (const c of cases) {
      const path = join(dir, `${c.label}.html`);
      writeFileSync(path, c.html, "utf8");
      assert.equal(hasPageCsp(c.html), false, `${c.label}: hasPageCsp`);
      const res = payload(runCli(["check-page", "--html", path], env).json);
      assert.equal(res.ok, false, `${c.label}: ok`);
      assert.equal(res.hasCsp, false, `${c.label}: hasCsp`);
    }
  } finally {
    cleanup();
  }
});

// 殻どおりのページの head と body に断片を足す (動きの点検の入力を作る)
function shellWith(head = "", body = ""): string {
  return render("lp", "centered").replace("</head>", `${head}\n</head>`).replace("</body>", `${body}\n</body>`);
}

const MOTION_STYLE = "<style>@keyframes spin { to { transform: rotate(1turn); } } .spin { animation: spin 1s linear infinite; }</style>";
const REDUCED_MOTION_STYLE = "<style>@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }</style>";

void test("check-page は reduced-motion の指定が無い動きを ok: false、指定のある動きと動きの無いページを ok: true にする", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const cases: { label: string; html: string; hasMotion: boolean; hasReducedMotion: boolean; ok: boolean }[] = [
      { label: "motion-without-reduced", html: shellWith(MOTION_STYLE), hasMotion: true, hasReducedMotion: false, ok: false },
      {
        label: "motion-with-media",
        html: shellWith(MOTION_STYLE + REDUCED_MOTION_STYLE),
        hasMotion: true,
        hasReducedMotion: true,
        ok: true,
      },
      {
        label: "motion-safe",
        html: shellWith("", '<div class="motion-safe:animate-spin">回る</div>'),
        hasMotion: true,
        hasReducedMotion: true,
        ok: true,
      },
      {
        label: "motion-reduce",
        html: shellWith("", '<div class="motion-reduce:transition-none transition-colors">色</div>'),
        hasMotion: true,
        hasReducedMotion: true,
        ok: true,
      },
      { label: "no-motion", html: shellWith(), hasMotion: false, hasReducedMotion: false, ok: true },
    ];
    for (const c of cases) {
      const path = join(dir, `${c.label}.html`);
      writeFileSync(path, c.html, "utf8");
      const res = payload(runCli(["check-page", "--html", path], env).json);
      assert.deepEqual(res.motion, { hasMotion: c.hasMotion, hasReducedMotion: c.hasReducedMotion, ok: c.ok }, `${c.label}: motion`);
      assert.equal(res.ok, c.ok, `${c.label}: ok`);
    }
  } finally {
    cleanup();
  }
});

void test("check-page は hover:・animate-*・style 属性の transition を動きとして数え、pre の中の文字は数えない", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const cases = [
      { label: "hover-transition", body: '<div class="hover:transition-transform">x</div>', hasMotion: true },
      { label: "animate-pulse", body: '<div class="animate-pulse">x</div>', hasMotion: true },
      { label: "style-attr", body: '<div style="transition: opacity .2s">x</div>', hasMotion: true },
      { label: "pre-text", body: "<pre>transition: x</pre>", hasMotion: false },
    ];
    for (const c of cases) {
      const path = join(dir, `${c.label}.html`);
      writeFileSync(path, shellWith("", c.body), "utf8");
      const motion = payload(payload(runCli(["check-page", "--html", path], env).json).motion);
      assert.equal(motion.hasMotion, c.hasMotion, `${c.label}: hasMotion`);
      assert.equal(motion.hasReducedMotion, false, `${c.label}: hasReducedMotion`);
      assert.equal(motion.ok, !c.hasMotion, `${c.label}: ok`);
    }
  } finally {
    cleanup();
  }
});

void test("pageHtml の extraStyles はテーマの style の直後に順に入り、空の css は入らず CSP はそのまま", () => {
  const input = { title: TITLE, themeId: THEME_ID, mode: MODE, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL, body: "<p>本文</p>" };
  const html = pageHtml({
    ...input,
    extraStyles: [
      { id: "surface", css: "a{}" },
      { id: "empty", css: "" },
      { id: "motion", css: "@keyframes x { to { opacity: 0; } }" },
    ],
  });
  assert.ok(
    html.includes(
      `</style>\n<style id="surface">\na{}\n</style>\n<style id="motion">\n@keyframes x { to { opacity: 0; } }\n</style>\n</head>`,
    ),
    "テーマの style の直後に並びの順で入る",
  );
  assert.ok(!html.includes('id="empty"'), "空の css は入れない");
  assert.equal(hasPageCsp(html), true, "hasPageCsp");
  assert.equal(pageHtml(input), pageHtml({ ...input, extraStyles: [] }), "省いたときと同じ出力");
});

void test("pageHtml の extraStyles は </style と id の形を CliExit(1) で止める", () => {
  const input = { title: TITLE, themeId: THEME_ID, mode: MODE, cssForPage: CSS_FOR_PAGE, fontsUrl: FONTS_URL, body: "<p>x</p>" };
  const isInputError = (error: unknown): boolean => error instanceof CliExit && error.code === EXIT_INPUT;
  for (const css of ["a</style>b", "a</STYLE><script>alert(1)</script>", "a</Style >b"]) {
    assert.throws(() => pageHtml({ ...input, extraStyles: [{ id: "surface", css }] }), isInputError, css);
  }
  assert.throws(() => pageHtml({ ...input, extraStyles: [{ id: "Surface", css: "a{}" }] }), isInputError, "id の形");
});
