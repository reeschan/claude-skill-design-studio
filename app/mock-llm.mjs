// テスト用の偽 claude CLI。DESIGN_STUDIO_LLM_CMD に JSON の配列で差し込む
// (例: ["<node のパス>", "app/mock-llm.mjs"])。
// MOCK_LLM_MODE: ok (既定) / error / bad-then-good / bad-page / no-csp / no-reduced-motion / motion-then-good
// 受け取った --json-schema の形 (properties.directions か properties.html) で、方向性の案か
// 1 ファイルの HTML かを見分ける。部品帳・部品・デザインガイドは、標準入力の
// 「作るもの:」の行 (component-sheet / component / design-guide) で見分けて、決まった出力を返す
import fs from "node:fs";

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  console.log("mock 1.0");
  process.exit(0);
}

const stdin = fs.readFileSync(0, "utf8");
const mode = process.env.MOCK_LLM_MODE || "ok";

// core/page-html.ts の PAGE_CSP と同じ値
const CSP =
  "default-src 'none'; script-src https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'";

function schema() {
  const i = argv.indexOf("--json-schema");
  if (i === -1 || argv[i + 1] === undefined) return {};
  try {
    return JSON.parse(argv[i + 1]);
  } catch {
    return {};
  }
}

const parsedSchema = schema();
const properties = typeof parsedSchema === "object" && parsedSchema !== null ? (parsedSchema.properties ?? {}) : {};
const hasHtmlSchema = typeof properties === "object" && properties !== null && Object.hasOwn(properties, "html");
const hasSketchSchema = typeof properties === "object" && properties !== null && Object.hasOwn(properties, "sketch");

// プロンプトの 2 行目の「作るもの:」の行で、部品帳・部品を見分ける。
// ページと方向性は今までどおり --json-schema の形 (properties.html) で見分ける。
// 背景スケッチは --json-schema の properties.sketch で見分ける
function kindOf() {
  if (hasSketchSchema) return "sketch";
  if (/^作るもの: design-guide$/m.test(stdin)) return "design-guide";
  if (/^作るもの: component-sheet$/m.test(stdin)) return "component-sheet";
  if (/^作るもの: component$/m.test(stdin)) return "component";
  return hasHtmlSchema ? "page" : "directions";
}

const kind = kindOf();

// MOCK_LLM_ARGS_FILE があれば、受け取った引数・標準入力 (プロンプト) と --add-dir の中身を書く (テストが見る)
const argsFile = process.env.MOCK_LLM_ARGS_FILE;
if (argsFile) {
  const i = argv.indexOf("--add-dir");
  const addDir = i === -1 ? null : (argv[i + 1] ?? null);
  let addDirFiles = null;
  if (addDir !== null) {
    try {
      addDirFiles = fs.readdirSync(addDir);
    } catch {
      addDirFiles = null;
    }
  }
  fs.writeFileSync(argsFile, JSON.stringify({ argv, addDir, addDirFiles, prompt: stdin }));
}

// bad-then-good 用の回数。プロセスは毎回別なので、ファイルに数える
function counter() {
  const file = process.env.MOCK_LLM_COUNTER;
  if (!file) return 0;
  let n = 0;
  try {
    n = Number(fs.readFileSync(file, "utf8")) || 0;
  } catch {
    n = 0;
  }
  fs.writeFileSync(file, String(n + 1));
  return n;
}

// デザインガイドの部品の id (core/types.ts の COMPONENT_CANDIDATES と同じ並び)
const DESIGN_GUIDE_COMPONENT_IDS = ["button", "input", "card", "nav", "tabs", "badge", "modal", "toast", "table", "pricing-card"];

// デザインガイドの値。core/design-guide.ts の validateDesignGuideValues を通る形にする
// (改行を含めない、keywords は 3 件、components の id は候補の順)
function designGuideValues() {
  return {
    tone: {
      words: {
        voice: "です・ます",
        style: "短い文で、語尾は「です・ます」にそろえます。",
        useWords: ["保存", "完了", "確認"],
        avoidWords: ["バグ", "失敗", "エラー"],
        examples: [
          { situation: "保存ボタン", text: "保存する" },
          { situation: "通信エラー", text: "通信できませんでした。もう一度お試しください。" },
        ],
      },
      visual: {
        keywords: ["落ち着き", "余白", "読みやすい"],
        treatmentUsage: ["カードの面は指定の面を使う", "見出しの動きは控えめにする"],
        avoid: ["強いグラデーション", "文字の詰め込み"],
      },
    },
    components: DESIGN_GUIDE_COMPONENT_IDS.map((id) => ({
      id,
      purpose: `${id} の用途`,
      states: "通常・ホバー・押下・フォーカス・無効",
      whereToUse: "主要な操作と、その確認",
      dont: "意味のない強調をしない",
    })),
  };
}

// 決まりを満たさない値 (validateDesignGuideValues に落ちる)
const BAD_DESIGN_GUIDE_VALUES = { tone: {}, components: [] };

// 方向性の案 4 つと family。どれも core/styles.ts の validateDirection を通る形。
// family は決めて "pricing" と答える (family 付きで呼ばれたときは呼び出し側が LLM の答えを使わない)
function directions() {
  return {
    directions: [
      {
        id: "dir-a",
        name: "静かな余白",
        rationale: "余白を広く取り、落ち着いた信頼感を伝えるため。",
        seed: {
          id: "dir-a",
          name: "静かな余白",
          tone: "落ち着きと信頼。",
          baseMode: "light",
          color: { brandHue: 215, brandChroma: 0.08, accentHue: 35, neutralHue: 220, neutralChroma: 0.01, contrast: 2 },
          shape: { radiusPx: 6, spacingScale: 1.25, shadow: "soft" },
          font: {
            mood: "humanist",
            heading: "Noto Sans JP",
            body: "Noto Sans JP",
            mono: "JetBrains Mono",
            pairId: "noto-sans-jp+noto-sans-jp",
          },
        },
        layouts: {
          lp: "centered",
          dashboard: "sidebar",
          blog: "classic",
          pricing: "tiers",
          product: "split",
          portfolio: "grid",
          settings: "sidebar",
        },
        copy: {
          brand: "ツクリ",
          tagline: "考えを、かたちに。",
          headline: "静けさが、いちばんよく伝える。",
          lead: "余白を活かして、大事なことだけを残す。",
          cta: "はじめる",
          items: [
            { title: "余白", body: "詰め込まず、呼吸できる画面に。" },
            { title: "文字", body: "読みやすさを第一にした字組み。" },
            { title: "信頼", body: "落ち着いた色で、安心を届ける。" },
          ],
        },
      },
      {
        id: "dir-b",
        name: "夜のネオン",
        rationale: "暗い基調と鮮やかな差し色で、勢いと個性を出すため。",
        seed: {
          id: "dir-b",
          name: "夜のネオン",
          tone: "勢いと遊び心。",
          baseMode: "dark",
          color: { brandHue: 320, brandChroma: 0.3, accentHue: 190, neutralHue: 300, neutralChroma: 0.03, contrast: 4.5 },
          shape: { radiusPx: 20, spacingScale: 1.4, shadow: "hard" },
          font: {
            mood: "tech",
            heading: "Noto Sans JP",
            body: "Noto Sans JP",
            mono: "JetBrains Mono",
            pairId: "noto-sans-jp+noto-sans-jp",
          },
        },
        layouts: {
          lp: "fullbleed",
          dashboard: "topnav",
          blog: "magazine",
          pricing: "spotlight",
          product: "story",
          portfolio: "showcase",
          settings: "tabs",
        },
        copy: {
          brand: "ネオン社",
          tagline: "夜を、もっと自由に。",
          headline: "暗いほど、光が効く。",
          lead: "黒を基調に、差し色で視線を導く。",
          cta: "ためす",
          items: [
            { title: "速度", body: "迷わせない動線で、すぐ届く。" },
            { title: "光", body: "差し色は一つに絞って効かせる。" },
            { title: "勢い", body: "大胆な字と余白で、記憶に残す。" },
          ],
        },
      },
      {
        id: "dir-c",
        name: "陽だまりの輪郭",
        rationale: "丸い形と明るい色で、親しみやすさを出すため。",
        seed: {
          id: "dir-c",
          name: "陽だまりの輪郭",
          tone: "親しみと軽やかさ。",
          baseMode: "light",
          color: { brandHue: 40, brandChroma: 0.16, accentHue: 140, neutralHue: 60, neutralChroma: 0.02, contrast: 1.8 },
          shape: { radiusPx: 28, spacingScale: 1, shadow: "soft" },
          font: {
            mood: "rounded",
            heading: "Noto Sans JP",
            body: "Noto Sans JP",
            mono: "JetBrains Mono",
            pairId: "noto-sans-jp+noto-sans-jp",
          },
        },
        layouts: {
          lp: "split",
          dashboard: "cards",
          blog: "minimal",
          pricing: "table",
          product: "gallery",
          portfolio: "list",
          settings: "stacked",
        },
        copy: {
          brand: "ひだまり",
          tagline: "やさしさを、まいにち。",
          headline: "まるい形は、やさしい。",
          lead: "角を丸く、色を明るく。近づきたくなる画面に。",
          cta: "のぞいてみる",
          items: [
            { title: "まる", body: "角を丸くして、やわらかく。" },
            { title: "ひかり", body: "明るい色で、気持ちを軽く。" },
            { title: "ゆとり", body: "行間を広く取り、読みやすく。" },
          ],
        },
      },
      {
        id: "dir-d",
        name: "設計の帳面",
        rationale: "細い罫線と味わい深い字組みで、誠実さを出すため。",
        seed: {
          id: "dir-d",
          name: "設計の帳面",
          tone: "誠実と味わい。",
          baseMode: "light",
          color: { brandHue: 340, brandChroma: 0.2, accentHue: null, neutralHue: 10, neutralChroma: 0.01, contrast: 3 },
          shape: { radiusPx: 2, spacingScale: 0.75, shadow: "none" },
          font: {
            mood: "serif",
            heading: "Noto Sans JP",
            body: "Noto Sans JP",
            mono: "JetBrains Mono",
            pairId: "noto-sans-jp+noto-sans-jp",
          },
        },
        layouts: {
          lp: "fullbleed",
          dashboard: "cards",
          blog: "classic",
          pricing: "spotlight",
          product: "gallery",
          portfolio: "showcase",
          settings: "stacked",
        },
        copy: {
          brand: "設計所",
          tagline: "丁寧に、確かめる。",
          headline: "確かめられた誠実さ。",
          lead: "細い罫線と味わいのある字で、信頼を形にする。",
          cta: "くわしく見る",
          items: [
            { title: "誠実", body: "むだを省き、確かめる。" },
            { title: "罫線", body: "細い線で、整然と。" },
            { title: "味わい", body: "字のあじで、しみじみと。" },
          ],
        },
      },
    ],
    family: "pricing",
  };
}

// プロンプト (標準入力) から、ルート要素に入れる値と style の id を推し量る
function extracted(re, fallback) {
  const m = stdin.match(re);
  return m ? m[1] : fallback;
}

function seedId() {
  return extracted(/"seed"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/, extracted(/"id"\s*:\s*"([^"]+)"/, "dir-a"));
}

function baseMode() {
  return extracted(/"baseMode"\s*:\s*"(light|dark)"/, "light");
}

// ページ・部品帳・部品で共通の殻 (参照のページ HTML の形 01M510GAC7MMH7RB6D594WSPVY)。
// title と body だけを差し替える
function shellHtml(themeId, mode, title, body) {
  return [
    "<!doctype html>",
    `<html lang="ja" data-theme="${themeId}" data-mode="${mode}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" id="theme-fonts">',
    '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.13"></script>',
    '<style type="text/tailwindcss" id="theme">',
    "/* 呼び出し側が差し替える */",
    "</style>",
    "</head>",
    '<body class="bg-background font-sans text-foreground">',
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// 作るものごとの title と body。部品帳・部品の body には動きを入れない
const CONTENTS = {
  page: {
    title: "モックのページ",
    body: [
      '<main class="mx-auto max-w-3xl p-8">',
      '<h1 class="font-heading text-3xl text-primary">モックの見出し</h1>',
      '<p class="text-muted-foreground">モックの本文。</p>',
      "</main>",
    ].join("\n"),
  },
  "component-sheet": {
    title: "モックの部品帳",
    body: [
      '<main class="mx-auto max-w-3xl space-y-8 p-8">',
      '<h1 class="font-heading text-3xl text-primary">モックの部品帳</h1>',
      "<section>",
      '<h2 class="font-heading text-xl">ボタン</h2>',
      '<div class="flex items-center gap-3">',
      '<button class="rounded-md bg-primary px-4 py-2 text-primary-foreground">ボタン</button>',
      '<button class="rounded-md bg-primary px-4 py-2 text-primary-foreground" disabled>無効</button>',
      "</div>",
      "</section>",
      "<section>",
      '<h2 class="font-heading text-xl">カード</h2>',
      '<div class="rounded-lg border border-border bg-card p-4 text-card-foreground">モックのカード</div>',
      "</section>",
      "</main>",
    ].join("\n"),
  },
  component: {
    title: "モックの部品",
    body: ['<main class="mx-auto max-w-3xl p-8">', '<h1 class="font-heading text-3xl text-primary">モックの部品</h1>', "</main>"].join(
      "\n",
    ),
  },
};

function contentOf(kind) {
  return CONTENTS[kind] ?? CONTENTS.page;
}

// 作るものの殻。title と body だけが違う
function htmlFor(kind, themeId, mode) {
  const content = contentOf(kind);
  return shellHtml(themeId, mode, content.title, content.body);
}

// 許可していない外部 URL を含む HTML (generatePage・generateComponent の検証に落ちる)
function badHtmlFor(kind, themeId, mode) {
  const content = contentOf(kind);
  return shellHtml(themeId, mode, content.title, `${content.body}\n<img src="https://example.com/photo.png" alt="写真">`);
}

// CSP の meta の行だけを除いた HTML (検証に落ちる)
function noCspHtmlFor(kind, themeId, mode) {
  return htmlFor(kind, themeId, mode).replace(`<meta http-equiv="Content-Security-Policy" content="${CSP}">\n`, "");
}

// 動きはあるが prefers-reduced-motion の指定が無い HTML (点検に落ちる)
function noReducedMotionHtmlFor(kind, themeId, mode) {
  return htmlFor(kind, themeId, mode).replace(
    "</head>",
    [
      "<style>",
      ".mock-animated { animation: mock-fade 1s ease; }",
      "@keyframes mock-fade {",
      "  from { opacity: 0; }",
      "  to { opacity: 1; }",
      "}",
      "</style>",
      "</head>",
    ].join("\n"),
  );
}

const out = (o) => console.log(JSON.stringify(o));

// 方向性の出力。bad-then-good だけ 1 回目に不正な形を返す
function directionsOutput() {
  if (mode !== "bad-then-good") return directions();
  const n = counter();
  const good = directions();
  return n === 0 ? { directions: good.directions.slice(0, 2) } : good;
}

// デザインガイドの値の出力。error は先に止まる。bad-page は決まりを満たさない値、
// bad-then-good は 1 回目だけ決まりを満たさない値、それ以外 (ok / no-csp / no-reduced-motion /
// motion-then-good) は決まった値
function designGuideOutput() {
  if (mode === "bad-page") return BAD_DESIGN_GUIDE_VALUES;
  if (mode === "bad-then-good") return counter() === 0 ? BAD_DESIGN_GUIDE_VALUES : designGuideValues();
  return designGuideValues();
}

// 背景スケッチの式。自前の関数だけで無彩色で描く (core/sketch-llm.ts の検証と、エンジンの step を通る)
const GOOD_SKETCH = `t=0;draw=()=>{createCanvas(1600,900);background(12).stroke(255,70);for(t+=0.01,i=0;i<240;i++){a=i*TWO_PI/240;r=280+140*sin(a*3+t*2);point(800+cos(a)*r,450+sin(a)*r*0.5625)}}`;

// 自前に無い関数 (noise4D) を呼ぶ式。1 フレーム目に unknown-name で止まる
const BROKEN_SKETCH = `t=0;draw=()=>{createCanvas(1600,900);background(12);noise4D(t+=0.01)}`;

// prompt に MOCK_BROKEN_SKETCH があり、かつ書き直し (「前回の式」) でなければ壊れた式を返す
function sketchCode() {
  return stdin.includes("MOCK_BROKEN_SKETCH") && !stdin.includes("前回の式") ? BROKEN_SKETCH : GOOD_SKETCH;
}

const htmlOutput = (html) => ({ is_error: false, structured_output: { html } });

if (mode === "error") {
  out({ is_error: true, result: "boom" });
} else if (kind === "sketch") {
  out({ is_error: false, structured_output: { sketch: sketchCode() } });
} else if (kind === "directions") {
  out({ is_error: false, structured_output: directionsOutput() });
} else if (kind === "design-guide") {
  out({ is_error: false, structured_output: designGuideOutput() });
} else if (mode === "bad-page") {
  out(htmlOutput(badHtmlFor(kind, seedId(), baseMode())));
} else if (mode === "no-csp") {
  out(htmlOutput(noCspHtmlFor(kind, seedId(), baseMode())));
} else if (mode === "bad-then-good") {
  const n = counter();
  out(htmlOutput(n === 0 ? badHtmlFor(kind, seedId(), baseMode()) : htmlFor(kind, seedId(), baseMode())));
} else if (mode === "no-reduced-motion") {
  // 回数は MOCK_LLM_COUNTER で見る (ページも部品も 2 回で止まる)
  counter();
  out(htmlOutput(noReducedMotionHtmlFor(kind, seedId(), baseMode())));
} else if (mode === "motion-then-good") {
  // 1 回目だけ reduced-motion の指定が無く、2 回目からは ok と同じ
  const n = counter();
  out(htmlOutput(n === 0 ? noReducedMotionHtmlFor(kind, seedId(), baseMode()) : htmlFor(kind, seedId(), baseMode())));
} else if (mode === "ok") {
  out(htmlOutput(htmlFor(kind, seedId(), baseMode())));
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}
