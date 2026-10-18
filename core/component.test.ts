// 部品の候補・名前・保存のキー (core/component.ts) を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import {
  COMPONENT_SHEET_KEY,
  COMPONENT_SHEET_NAME,
  componentCandidateOf,
  componentItemIdentity,
  componentKeyOf,
  validateComponentName,
  validateComponentTarget,
} from "./component.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";

// 部品の保存のキーの形 (contract.md の 2 節)
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// 入力の誤り (終了コード 1 の input) で止まることを確かめる
function assertInputError(fn: () => unknown, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input", label);
}

void test("候補は 10 個で、contract.md の表の id と名前をこの順で持つ", () => {
  assert.deepEqual(COMPONENT_CANDIDATES, [
    { id: "button", name: "ボタン" },
    { id: "input", name: "入力欄" },
    { id: "card", name: "カード" },
    { id: "nav", name: "ヘッダーのナビ" },
    { id: "tabs", name: "タブ" },
    { id: "badge", name: "バッジ/タグ" },
    { id: "modal", name: "モーダル" },
    { id: "toast", name: "トースト" },
    { id: "table", name: "表" },
    { id: "pricing-card", name: "料金カード" },
  ]);
  assert.equal(new Set(COMPONENT_CANDIDATES.map((candidate) => candidate.id)).size, 10, "id は重複しない");
});

void test("componentCandidateOf は候補の名前と完全一致 (trim 後) のときだけ返す", () => {
  assert.deepEqual(componentCandidateOf("ボタン"), { id: "button", name: "ボタン" });
  assert.deepEqual(componentCandidateOf("  料金カード  "), { id: "pricing-card", name: "料金カード" });
  assert.equal(componentCandidateOf("ボタン風"), undefined);
  assert.equal(componentCandidateOf("button"), undefined);
  assert.equal(componentCandidateOf(""), undefined);
});

void test("候補の名前のキーは候補の id (前後の空白つきでも)", () => {
  for (const candidate of COMPONENT_CANDIDATES) {
    assert.equal(componentKeyOf(candidate.name), candidate.id);
    assert.equal(componentKeyOf(`  ${candidate.name}  `), candidate.id);
  }
});

void test("自由な名前のキーは /^[a-z0-9][a-z0-9-]{0,39}$/ に合い、component-sheet とは一致しない", () => {
  const names = ["Landing Page", "Plan 2026", "プラン比較", "!!!", "-----", "a".repeat(80), "", "component-sheet", "ボタン風"];
  for (const name of names) {
    const key = componentKeyOf(name);
    assert.match(key, KEY_RE, name);
    assert.ok(key.length <= 40, `${name}: 40 文字以内`);
    assert.notEqual(key, COMPONENT_SHEET_KEY, name);
  }
});

void test("同じ名前からは同じキー、NFKC で同じになる名前も同じキー、違う名前は違うキー", () => {
  assert.equal(componentKeyOf("プラン比較"), componentKeyOf("プラン比較"));
  assert.equal(componentKeyOf("  Plan 2026  "), componentKeyOf("Plan 2026"));
  assert.equal(componentKeyOf("Ｂｕｔｔｏｎ"), componentKeyOf("Button"));
  assert.notEqual(componentKeyOf("プラン比較"), componentKeyOf("料金表"));
  assert.notEqual(componentKeyOf("Button A"), componentKeyOf("Button B"));
});

void test("日本語だけの名前のキーは component- で始まる", () => {
  assert.ok(componentKeyOf("部品").startsWith("component-"));
  assert.ok(componentKeyOf("   ").startsWith("component-"));
  assert.ok(componentKeyOf("!!!").startsWith("component-"));
});

void test("validateComponentName は trim 後の値を返し、1〜40 文字を受け付ける", () => {
  assert.equal(validateComponentName("  ボタン  "), "ボタン");
  assert.equal(validateComponentName("a"), "a");
  assert.equal(validateComponentName("a".repeat(40)), "a".repeat(40));
  assert.equal(validateComponentName(`  ${"a".repeat(40)}  `), "a".repeat(40));
});

void test("validateComponentName は文字列でない・空・41 文字以上・制御文字・< > を入力の誤りにする", () => {
  const nonStrings: [unknown, string][] = [
    [1, "数値"],
    [null, "null"],
    [undefined, "undefined"],
    [{}, "オブジェクト"],
    [[], "配列"],
  ];
  for (const [value, label] of nonStrings) {
    assertInputError(() => validateComponentName(value), `文字列でない: ${label}`);
  }
  assertInputError(() => validateComponentName(""), "空の名前");
  assertInputError(() => validateComponentName("   "), "空白だけの名前");
  assertInputError(() => validateComponentName("a".repeat(41)), "41 文字の名前");
  for (const char of ["\u0000", "\n", "\u001f", "\u007f", "<", ">"]) {
    assertInputError(() => validateComponentName(`ボタン${char}風`), `禁じた文字: ${JSON.stringify(char)}`);
  }
});

void test("validateComponentTarget は部品帳と部品を通し、部品の名前は trim する", () => {
  assert.deepEqual(validateComponentTarget({ kind: "component-sheet" }), { kind: "component-sheet" });
  assert.deepEqual(validateComponentTarget({ kind: "component", name: "  ボタン  " }), { kind: "component", name: "ボタン" });
});

void test("validateComponentTarget は知らない kind と余分な形を入力の誤りにする", () => {
  assertInputError(() => validateComponentTarget({ kind: "page" }), "page");
  assertInputError(() => validateComponentTarget({ kind: "design-guide" }), "design-guide");
  assertInputError(() => validateComponentTarget({}), "kind なし");
  assertInputError(() => validateComponentTarget({ kind: "component" }), "name なし");
  assertInputError(() => validateComponentTarget({ kind: "component", name: 1 }), "数値の name");
  assertInputError(() => validateComponentTarget({ kind: "component-sheet", name: "部品帳" }), "部品帳の余分な項目");
  assertInputError(() => validateComponentTarget({ kind: "component", name: "ボタン", extra: true }), "部品の余分な項目");
  assertInputError(() => validateComponentTarget(null), "null");
  assertInputError(() => validateComponentTarget([]), "配列");
  assertInputError(() => validateComponentTarget("component"), "文字列");
});

void test("componentItemIdentity は部品帳に固定のキーと名前、部品に名前ごとのキーと名前を返す", () => {
  assert.equal(COMPONENT_SHEET_KEY, "component-sheet");
  assert.equal(COMPONENT_SHEET_NAME, "部品帳");
  assert.deepEqual(componentItemIdentity({ kind: "component-sheet" }), { key: "component-sheet", name: "部品帳" });
  assert.deepEqual(componentItemIdentity({ kind: "component", name: "ボタン" }), { key: "button", name: "ボタン" });
  assert.deepEqual(componentItemIdentity({ kind: "component", name: "ボタン風" }), { key: componentKeyOf("ボタン風"), name: "ボタン風" });
});
