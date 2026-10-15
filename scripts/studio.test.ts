// CLI の入口 (scripts/studio.ts) の約束を外から確かめる
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli, tempEnv } from "./test-helper.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

void test("引数なしは usage で終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli([], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "usage");
  } finally {
    cleanup();
  }
});

void test("不明なサブコマンドは usage で終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["bogus"], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "usage");
  } finally {
    cleanup();
  }
});

void test("catalog は空の実装で not-implemented と終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["catalog"], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "not-implemented");
    assert.equal(payload(res.json).command, "catalog");
  } finally {
    cleanup();
  }
});

void test("失敗は標準出力を空にし、JSON を標準エラーに 1 行で出し、runCli の json で読める", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["bogus"], env);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr.trim().split("\n").length, 1);
    assert.ok(res.stderr.includes('"error":"usage"'));
    assert.equal(payload(res.json).error, "usage");
  } finally {
    cleanup();
  }
});
