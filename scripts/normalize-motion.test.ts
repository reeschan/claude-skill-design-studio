// normalize-motion と motion-dictionary の終了コードと JSON
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runCli, tempEnv } from "./test-helper.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

void test("normalize-motion は entry を JSON で返し、入力が足りないと usage", () => {
  const { env, cleanup } = tempEnv();
  try {
    const ok = runCli(["normalize-motion", "--section", "hero", "--target", "bg", "背景だけゆっくり動かしたい"], env);
    assert.equal(ok.code, 0, ok.stderr);
    const body = payload(ok.json);
    assert.equal(body.ok, true);
    const entries = body.entries;
    assert.ok(Array.isArray(entries) && isRecord(entries[0]));
    assert.equal(entries[0]?.effect && Array.isArray(entries[0].effect) ? entries[0].effect[0] : "", "parallax");
    const missing = runCli(["normalize-motion"], env);
    assert.equal(missing.code, 1);
    assert.equal(payload(missing.json).error, "usage");
    assert.equal(missing.stdout, "");
  } finally {
    cleanup();
  }
});

void test("相性の悪い組み合わせは終了コード 1 で日本語のエラー", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["normalize-motion", "--section", "features", "スクロール連動でカードが上に重なる"], env);
    assert.equal(res.code, 1);
    assert.equal(res.stdout, "");
    const body = payload(res.json);
    assert.equal(body.error, "input");
    assert.ok(String(body.message).includes("組み合わせられません"));
  } finally {
    cleanup();
  }
});

void test("motion-dictionary --markdown は Motion 節を書き出せる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const listed = runCli(["motion-dictionary"], env);
    assert.equal(listed.code, 0, listed.stderr);
    const effects = payload(listed.json).effects;
    assert.ok(Array.isArray(effects) && effects.length === 38);
    const file = join(dir, "DESIGN.md");
    const written = runCli(["motion-dictionary", "--markdown", "--out", file], env);
    assert.equal(written.code, 0, written.stderr);
    assert.equal(payload(written.json).file, file);
    assert.ok(readFileSync(file, "utf8").includes("## Motion"));
  } finally {
    cleanup();
  }
});
