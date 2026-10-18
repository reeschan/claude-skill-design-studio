// data/surfaces.json (面の台帳) と data/motions.json (動きの見本集) を直接読み、
// 取り決め (docs/pbi/notes/contract.md の 2 節) の形と、CSS・HTML の決まりを外から確かめる
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;

const SURFACE_IDS = ["none", "material", "glass", "solid"] as const;
const SURFACE_KEYS = ["id", "name", "description", "instructions", "css", "examples"] as const;
const MOTION_KEYS = [
  "id",
  "name",
  "description",
  "uses",
  "technique",
  "css",
  "html",
  "support",
  "supportNote",
  "continuous",
  "scrollLinked",
  "reducedMotion",
  "references",
] as const;

// 取り決めの 2 節の表の 12 件 (id・support・continuous・scrollLinked)
const MOTION_TABLE = [
  { id: "spinning-border", support: "baseline", continuous: true, scrollLinked: false },
  { id: "shimmer-text", support: "baseline", continuous: true, scrollLinked: false },
  { id: "scroll-reveal", support: "fallback", continuous: false, scrollLinked: true },
  { id: "reading-progress", support: "fallback", continuous: false, scrollLinked: true },
  { id: "entry-transition", support: "baseline", continuous: false, scrollLinked: false },
  { id: "spring-press", support: "baseline", continuous: false, scrollLinked: false },
  { id: "stagger", support: "fallback", continuous: false, scrollLinked: false },
  { id: "aurora", support: "baseline", continuous: true, scrollLinked: false },
  { id: "skeleton-shimmer", support: "baseline", continuous: true, scrollLinked: false },
  { id: "line-draw", support: "baseline", continuous: false, scrollLinked: false },
  { id: "blob", support: "baseline", continuous: true, scrollLinked: false },
  { id: "marquee", support: "baseline", continuous: true, scrollLinked: false },
] as const;

// CSS に書いてはいけない、色の直書きと外部の参照
const FORBIDDEN_CSS = ["rgb(", "rgba(", "hsl(", "hsla(", "oklch(", "lab(", "url(", "</style"] as const;
// `#` の 16 進の色 (例: #fff・#0a0a0a)
const HEX_COLOR_RE = /#[0-9a-f]{3,8}\b/i;
// インラインのイベント属性 (例: onclick=)
const EVENT_ATTRIBUTE_RE = /\son[a-z]+\s*=/i;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function jsonFile(name: string): Json {
  const path = fileURLToPath(new URL(`../data/${name}`, import.meta.url));
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isRecord(value), `${name} の根はオブジェクト`);
  return value;
}

function listOf(data: Json, key: string): Json[] {
  const value = data[key];
  assert.ok(Array.isArray(value), `${key} は配列`);
  return (value as unknown[]).map((item, index) => {
    assert.ok(isRecord(item), `${key}[${index}] はオブジェクト`);
    return item;
  });
}

function readString(entry: Json, key: string): string {
  const value = entry[key];
  assert.ok(typeof value === "string", `${key} は文字列`);
  return value;
}

function readNonEmptyString(entry: Json, key: string, label: string): string {
  const value = readString(entry, key);
  assert.notEqual(value, "", `${label}: ${key} は空でない`);
  return value;
}

function readStringArray(entry: Json, key: string): string[] {
  const value = entry[key];
  assert.ok(Array.isArray(value), `${key} は配列`);
  return (value as unknown[]).map((item, index) => {
    assert.ok(typeof item === "string", `${key}[${index}] は文字列`);
    return item;
  });
}

function assertKeys(entry: Json, keys: readonly string[], label: string): void {
  for (const key of keys) assert.ok(key in entry, `${label}: ${key} がある`);
}

function assertSurfaceEntry(entry: Json, expectedId: string): void {
  assertKeys(entry, SURFACE_KEYS, `surface ${expectedId}`);
  assert.equal(readString(entry, "id"), expectedId);
  readNonEmptyString(entry, "name", expectedId);
  readString(entry, "description");
  readString(entry, "css");
  readStringArray(entry, "instructions");
  readStringArray(entry, "examples");
  if (expectedId === "none") {
    assert.equal(readString(entry, "css"), "", "none: css は空文字");
    assert.deepEqual(readStringArray(entry, "instructions"), [], "none: instructions は空配列");
    return;
  }
  readNonEmptyString(entry, "description", expectedId);
  readNonEmptyString(entry, "css", expectedId);
  assert.ok(readStringArray(entry, "instructions").length > 0, `${expectedId}: instructions は空でない`);
  assert.ok(readStringArray(entry, "examples").length > 0, `${expectedId}: examples は空でない`);
}

function assertMotionEntry(entry: Json, expected: (typeof MOTION_TABLE)[number]): void {
  assertKeys(entry, MOTION_KEYS, `motion ${expected.id}`);
  assert.equal(readString(entry, "id"), expected.id);
  assert.equal(readString(entry, "support"), expected.support);
  assert.equal(typeof entry.continuous, "boolean", `${expected.id}: continuous は真偽値`);
  assert.equal(typeof entry.scrollLinked, "boolean", `${expected.id}: scrollLinked は真偽値`);
  assert.equal(entry.continuous, expected.continuous);
  assert.equal(entry.scrollLinked, expected.scrollLinked);
  for (const key of ["name", "description", "technique", "css", "html", "supportNote", "reducedMotion"]) {
    readNonEmptyString(entry, key, expected.id);
  }
  for (const key of ["uses", "references"]) {
    assert.ok(readStringArray(entry, key).length > 0, `${expected.id}: ${key} は空でない`);
  }
}

function assertSafeCss(css: string, label: string): void {
  assert.ok(!HEX_COLOR_RE.test(css), `${label}: 16 進の色を直書きしていない`);
  const lower = css.toLowerCase();
  for (const token of FORBIDDEN_CSS) {
    assert.ok(!lower.includes(token), `${label}: ${token} を含まない`);
  }
}

function assertSurfaceCss(css: string, id: string): void {
  const lower = css.toLowerCase();
  for (const token of ["@keyframes", "animation", "transition"]) {
    assert.ok(!lower.includes(token), `surface ${id}: ${token} を含まない`);
  }
}

// CSS の規則を `{` と `}` で切り出し、セレクタと本文に分ける (面の CSS は入れ子を持たない)
function cssRules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

function assertMotionCss(entry: Json): void {
  const id = readString(entry, "id");
  const css = readString(entry, "css");
  assertSafeCss(css, `motion ${id}`);
  assert.ok(css.includes("prefers-reduced-motion"), `motion ${id}: reduced-motion の扱いがある`);
  if (readString(entry, "support") === "fallback") {
    assert.ok(css.includes("@supports"), `motion ${id}: fallback は @supports を持つ`);
  }
}

const SURFACES = jsonFile("surfaces.json");
const MOTIONS = jsonFile("motions.json");

// 面の台帳から solid の CSS を取り出す
function solidCss(): string {
  const solid = listOf(SURFACES, "surfaces").find((entry) => entry["id"] === "solid");
  assert.ok(solid !== undefined, "solid がある");
  return readString(solid, "css");
}

void test("面の台帳は none・material・glass・solid の 4 件で、キーと型が決まりどおり", () => {
  const surfaces = listOf(SURFACES, "surfaces");
  assert.equal(surfaces.length, SURFACE_IDS.length);
  for (const [index, entry] of surfaces.entries()) {
    const id = SURFACE_IDS[index];
    assert.ok(id !== undefined);
    assertSurfaceEntry(entry, id);
  }
});

void test("動きの見本は表の 12 件がその順にあり、キー・型・support などが表と一致する", () => {
  const motions = listOf(MOTIONS, "motions");
  assert.equal(motions.length, MOTION_TABLE.length);
  for (const [index, expected] of MOTION_TABLE.entries()) {
    const entry = motions[index];
    assert.ok(entry !== undefined, `${expected.id} がある`);
    assertMotionEntry(entry, expected);
  }
});

void test("CSS は色を直書きせず、面は動かず、見本は reduced-motion の扱いを持つ", () => {
  for (const entry of listOf(SURFACES, "surfaces")) {
    const id = readString(entry, "id");
    const css = readString(entry, "css");
    assertSafeCss(css, `surface ${id}`);
    assertSurfaceCss(css, id);
  }
  for (const entry of listOf(MOTIONS, "motions")) assertMotionCss(entry);
});

void test("見本の HTML はスクリプト・イベント属性・外部の URL を使わない", () => {
  for (const entry of listOf(MOTIONS, "motions")) {
    const id = readString(entry, "id");
    const html = readString(entry, "html");
    assert.ok(!html.toLowerCase().includes("<script"), `motion ${id}: <script を含まない`);
    assert.ok(!EVENT_ATTRIBUTE_RE.test(html), `motion ${id}: インラインのイベント属性を含まない`);
    assert.ok(!/https?:/i.test(html), `motion ${id}: 外部の URL を含まない`);
  }
});

void test("見本の参考ページは https の URL を 1 件以上持つ", () => {
  for (const entry of listOf(MOTIONS, "motions")) {
    const id = readString(entry, "id");
    const references = readStringArray(entry, "references");
    assert.ok(references.length >= 1, `motion ${id}: references は 1 件以上`);
    for (const reference of references) {
      assert.ok(reference.startsWith("https://"), `motion ${id}: ${reference} は https`);
    }
  }
});

void test("solid の CSS はグラデーションを使う要素を属性セレクタでべた塗りにする", () => {
  const rules = cssRules(solidCss());
  for (const kind of ["bg-linear", "bg-radial", "bg-conic"]) {
    const selector = `[class*="${kind}"]`;
    const rule = rules.find((item) => item.selector.includes(selector));
    assert.ok(rule !== undefined, `solid: ${selector} の属性セレクタを持つ`);
    assert.ok(rule.body.includes("background-image: none"), `solid: ${selector} は背景の画像を使わない`);
    assert.ok(rule.body.includes("background-color: var(--primary)"), `solid: ${selector} は var(--primary) のべた塗り`);
  }
});

void test("solid の CSS は section の地を塗らない", () => {
  const sectionRules = cssRules(solidCss()).filter((rule) => /\bsection\b/.test(rule.selector));
  assert.ok(sectionRules.length > 0, "solid: section を含む規則がある");
  for (const rule of sectionRules) {
    assert.ok(!rule.body.includes("var(--card)"), `solid: ${rule.selector} は var(--card) を塗らない`);
  }
});
