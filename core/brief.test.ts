// 依頼 (core/brief.ts) の検証を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBrief } from "./brief.ts";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";

// what が無い・空白だけのときの文言 (contract.md の 3 節)
const WHAT_MESSAGE = "作りたいもの (brief.what) を書いてください";

// 入力の誤り (終了コード 1 の input) で止まることを確かめる
function assertInputError(fn: () => unknown, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input", label);
}

void test("what が無い・空白だけのときは取り決めの文言で止まる", () => {
  for (const brief of [{}, { mood: "静か" }, { what: "" }, { what: "   " }]) {
    assert.throws(
      () => validateBrief(brief),
      (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input" && e.payload.message === WHAT_MESSAGE,
      JSON.stringify(brief),
    );
  }
  assertInputError(() => validateBrief({ what: 1 }), "数値の what");
});

void test("任意の項目は省くと空文字になる", () => {
  assert.deepEqual(validateBrief({ what: "請求書アプリ" }), { what: "請求書アプリ", mood: "", audience: "", mustHave: "" });
});

void test("前後の空白は落とす", () => {
  assert.deepEqual(validateBrief({ what: "  請求書アプリ  ", mood: " 静か ", audience: "\n", mustHave: " 合計金額 " }), {
    what: "請求書アプリ",
    mood: "静か",
    audience: "",
    mustHave: "合計金額",
  });
});

void test("長すぎる値は入力の誤り、上限ちょうどは通る", () => {
  assertInputError(() => validateBrief({ what: "a".repeat(2001) }), "what 2001 文字");
  assertInputError(() => validateBrief({ what: "請求書アプリ", mood: "a".repeat(501) }), "mood 501 文字");
  assertInputError(() => validateBrief({ what: "請求書アプリ", audience: "a".repeat(501) }), "audience 501 文字");
  assertInputError(() => validateBrief({ what: "請求書アプリ", mustHave: "a".repeat(501) }), "mustHave 501 文字");
  assertInputError(() => validateBrief({ what: "請求書アプリ", mood: 1 }), "数値の mood");
  assertInputError(() => validateBrief("nope"), "オブジェクトでない");

  const brief = validateBrief({ what: "a".repeat(2000), mood: "b".repeat(500) });
  assert.equal(brief.what.length, 2000);
  assert.equal(brief.mood.length, 500);
});
