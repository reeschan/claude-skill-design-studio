// 画面の種類の検証と、ページの保存のキー (core/page-type.ts) を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { candidateOf, pageKeyOf, validatePageType } from "./page-type.ts";
import { PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "./types.ts";
import type { PageType } from "./types.ts";

// ページの保存のキーの形 (contract.md の 2 節)
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// 入力の誤り (終了コード 1 の input) で止まることを確かめる
function assertInputError(fn: () => unknown, label: string): void {
  assert.throws(fn, (e: unknown) => e instanceof CliExit && e.code === EXIT_INPUT && e.payload.error === "input", label);
}

void test("候補は 7 つで、contract.md の表の名前と family を持つ", () => {
  assert.deepEqual(PAGE_TYPE_CANDIDATES, [
    { name: "LP", family: "lp" },
    { name: "ダッシュボード", family: "dashboard" },
    { name: "ブログ記事", family: "blog" },
    { name: "料金ページ", family: "pricing" },
    { name: "商品詳細", family: "product" },
    { name: "ポートフォリオ", family: "portfolio" },
    { name: "設定画面", family: "settings" },
  ]);
  assert.deepEqual(
    PAGE_TYPE_CANDIDATES.map((candidate) => candidate.family),
    [...SKELETON_FAMILIES],
  );
});

void test("candidateOf は候補の名前と完全一致 (trim 後) のときだけ返す", () => {
  assert.deepEqual(candidateOf("料金ページ"), { name: "料金ページ", family: "pricing" });
  assert.deepEqual(candidateOf("  料金ページ  "), { name: "料金ページ", family: "pricing" });
  assert.equal(candidateOf("料金"), undefined);
  assert.equal(candidateOf("プラン比較"), undefined);
});

void test("候補の名前のキーは family そのもの", () => {
  for (const candidate of PAGE_TYPE_CANDIDATES) {
    assert.equal(pageKeyOf(candidate), candidate.family);
  }
});

void test("自由な名前のキーは、同じ family でも名前が違えば別、名前が同じなら family を変えても同じ", () => {
  const plan: PageType = { name: "プラン比較", family: "pricing" };
  const table: PageType = { name: "料金表", family: "pricing" };
  assert.notEqual(pageKeyOf(plan), pageKeyOf(table));
  assert.equal(pageKeyOf({ name: "料金ページ", family: "pricing" }), "pricing");
  for (const family of SKELETON_FAMILIES) {
    assert.equal(pageKeyOf({ name: "プラン比較", family }), pageKeyOf(plan), family);
  }
});

void test("pageKeyOf は名前を先に trim と NFKC にしてから、候補の判定・見出し・ハッシュに使う", () => {
  const plan: PageType = { name: "プラン比較", family: "pricing" };
  assert.equal(pageKeyOf({ name: "  プラン比較  ", family: "pricing" }), pageKeyOf(plan), "前後の空白はキーを変えない");
  assert.equal(pageKeyOf({ name: " 料金ページ ", family: "lp" }), "pricing", "候補の判定は trim 後に行う");
  assert.equal(pageKeyOf({ name: "ＬＰ", family: "portfolio" }), "lp", "NFKC した名前で候補を判定する");
});

void test("どのキーも /^[a-z0-9][a-z0-9-]{0,39}$/ に合う (英字・記号だけ・80 文字の名前でも)", () => {
  const names = ["Landing Page", "Plan 2026", "プラン比較", "!!!", "-----", "a".repeat(80), "料金ページ"];
  for (const name of names) {
    for (const family of SKELETON_FAMILIES) {
      const key = pageKeyOf({ name, family });
      const label = `${name} / ${family}`;
      assert.match(key, KEY_RE, label);
      assert.ok(key.length <= 40, `${label}: 40 文字以内`);
    }
  }
});

void test("validatePageType は名前を trim して返し、family は任意", () => {
  assert.deepEqual(validatePageType({ name: "  プラン比較  " }), { name: "プラン比較" });
  assert.deepEqual(validatePageType({ name: "プラン比較", family: "pricing" }), { name: "プラン比較", family: "pricing" });
  assert.deepEqual(validatePageType({ name: "a".repeat(40) }), { name: "a".repeat(40) });
});

void test("validatePageType は空の名前・41 文字以上・知らない family を入力の誤りにする", () => {
  assertInputError(() => validatePageType({ name: "" }), "空の名前");
  assertInputError(() => validatePageType({ name: "   " }), "空白だけの名前");
  assertInputError(() => validatePageType({ name: "a".repeat(41) }), "41 文字の名前");
  assertInputError(() => validatePageType({ name: "プラン比較", family: "nope" }), "知らない family");
  assertInputError(() => validatePageType({ name: "プラン比較", family: 1 }), "数値の family");
  assertInputError(() => validatePageType({ name: 1 }), "数値の名前");
  assertInputError(() => validatePageType("nope"), "オブジェクトでない");
});
