// 台帳 (catalog) の読み込み・導入状態・使う/使わないを、CLI を外から叩いて確かめる
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readJsonFile } from "../core/json-file.ts";
import { runCli, tempEnv } from "./test-helper.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 応答の entries をオブジェクトの配列として読む
function entries(json: unknown): Record<string, unknown>[] {
  const value = payload(json).entries;
  if (!isUnknownArray(value)) throw new Error(`entries が配列ではありません: ${JSON.stringify(json)}`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`entries の要素がオブジェクトではありません: ${JSON.stringify(item)}`);
    return item;
  });
}

// 応答の 1 件から、追加台帳 (catalog.local.json) に書ける項目だけを取り出す
function asLocalEntry(view: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...view };
  delete entry.installed;
  delete entry.enabled;
  delete entry.origin;
  return entry;
}

void test("何も入っていないときは 13 件で、すべて未導入・使う・同梱", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0);
    const list = entries(res.json);
    assert.equal(list.length, 13);
    assert.equal(new Set(list.map((entry) => entry.id)).size, 13);
    for (const entry of list) {
      assert.equal(entry.installed, false);
      assert.equal(entry.enabled, true);
      assert.equal(entry.origin, "bundled");
    }
  } finally {
    cleanup();
  }
});

void test("スキル置き場に SKILL.md があるものだけ installed になる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const skillDir = join(dir, "skills", "fixing-accessibility");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# fixing-accessibility\n", "utf8");
    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0);
    const installed = entries(res.json)
      .filter((entry) => entry.installed === true)
      .map((entry) => entry.id);
    assert.deepEqual(installed, ["fixing-accessibility"]);
  } finally {
    cleanup();
  }
});

void test("プラグイン置き場は skills/<id>/SKILL.md を見て、marketplaces の下は見ない", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const pluginSkill = join(dir, "plugins", "synced", "x", "y", "skills", "design-critique");
    mkdirSync(pluginSkill, { recursive: true });
    writeFileSync(join(pluginSkill, "SKILL.md"), "# design-critique\n", "utf8");
    const marketplace = join(dir, "plugins", "marketplaces", "m", "plugins", "frontend-design", "skills", "frontend-design");
    mkdirSync(marketplace, { recursive: true });
    writeFileSync(join(marketplace, "SKILL.md"), "# frontend-design\n", "utf8");
    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0);
    const list = entries(res.json);
    assert.equal(list.find((entry) => entry.id === "design-critique")?.installed, true);
    assert.equal(list.find((entry) => entry.id === "frontend-design")?.installed, false);
  } finally {
    cleanup();
  }
});

void test("catalog --set で使う/使わないを変え、config.json に残る", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const set = runCli(["catalog", "--set", "react-doctor", "--enabled", "false"], env);
    assert.equal(set.code, 0);
    const entry = payload(set.json).entry;
    if (!isRecord(entry)) throw new Error(`entry がオブジェクトではありません: ${JSON.stringify(entry)}`);
    assert.equal(entry.id, "react-doctor");
    assert.equal(entry.enabled, false);

    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0);
    assert.equal(entries(res.json).find((item) => item.id === "react-doctor")?.enabled, false);

    const config = readJsonFile(join(dir, "home", "config.json"), "config.json");
    if (!isRecord(config)) throw new Error(`config.json がオブジェクトではありません: ${JSON.stringify(config)}`);
    const enabled = config.enabled;
    if (!isRecord(enabled)) throw new Error(`config.json の enabled がオブジェクトではありません: ${JSON.stringify(enabled)}`);
    assert.equal(enabled["react-doctor"], false);
  } finally {
    cleanup();
  }
});

void test("追加台帳は同じ id を上書きし、origin は local になる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const base = entries(runCli(["catalog"], env).json).find((entry) => entry.id === "style-guide");
    assert.ok(base !== undefined);
    const local: Record<string, unknown> = { ...base, summary: "利用者が書いた説明" };
    delete local.installed;
    delete local.enabled;
    delete local.origin;
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "catalog.local.json"), JSON.stringify([local], null, 2), "utf8");

    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0);
    const list = entries(res.json);
    assert.equal(list.length, 13);
    const entry = list.find((item) => item.id === "style-guide");
    assert.ok(entry !== undefined);
    assert.equal(entry.summary, "利用者が書いた説明");
    assert.equal(entry.origin, "local");
  } finally {
    cleanup();
  }
});

void test("説明の文が空文字でも追加台帳の検証を通り、origin は local になる", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const base = entries(runCli(["catalog"], env).json).find((entry) => entry.id === "style-guide");
    assert.ok(base !== undefined);
    const local = { ...asLocalEntry(base), id: "my-extra-skill", summary: "", exampleRequest: "", exampleOutput: "" };
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "catalog.local.json"), JSON.stringify([local], null, 2), "utf8");

    const res = runCli(["catalog"], env);
    assert.equal(res.code, 0, res.stderr);
    const entry = entries(res.json).find((item) => item.id === "my-extra-skill");
    assert.ok(entry !== undefined);
    assert.equal(entry.origin, "local");
    assert.equal(entry.summary, "");
    assert.equal(entry.exampleRequest, "");
    assert.equal(entry.exampleOutput, "");
  } finally {
    cleanup();
  }
});

void test("取得元の repo と path がリポジトリの外を指すものは終了コード 1", () => {
  const { dir, env, cleanup } = tempEnv();
  try {
    const base = entries(runCli(["catalog"], env).json).find((entry) => entry.id === "style-guide");
    assert.ok(base !== undefined);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const ref = "0f63f19b3b710c86a89c853b71b5e41bf4b89d8f";
    const badSources = [
      { repo: "../..", path: "../../../../Users/owner/.ssh" },
      { repo: "owner", path: "skills/a" },
      { repo: "owner/name/extra", path: "skills/a" },
      { repo: "owner/..", path: "skills/a" },
      { repo: "owner/name", path: "../x" },
      { repo: "owner/name", path: "C:/Users/owner/.claude" },
      { repo: "owner/name", path: "/etc" },
      { repo: "owner/name", path: "a\\b" },
      { repo: "owner/name", path: "a//b" },
      { repo: "owner/name", path: "skills/" },
    ];
    for (const { repo, path } of badSources) {
      const local = { ...asLocalEntry(base), id: "my-extra-skill", source: { type: "github", repo, path, ref } };
      writeFileSync(join(home, "catalog.local.json"), JSON.stringify([local], null, 2), "utf8");
      const res = runCli(["catalog"], env);
      assert.equal(res.code, 1, `repo: ${repo} / path: ${path}`);
      assert.equal(payload(res.json).error, "input", `repo: ${repo} / path: ${path}`);
    }
  } finally {
    cleanup();
  }
});

void test("知らない id の --set は終了コード 1", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["catalog", "--set", "nope", "--enabled", "false"], env);
    assert.equal(res.code, 1);
    assert.equal(payload(res.json).error, "input");
  } finally {
    cleanup();
  }
});

void test("catalog --stage はその段階のものだけを返す", () => {
  const { env, cleanup } = tempEnv();
  try {
    const res = runCli(["catalog", "--stage", "review"], env);
    assert.equal(res.code, 0);
    const list = entries(res.json);
    assert.equal(list.length, 6);
    for (const entry of list) assert.equal(entry.stage, "review");
  } finally {
    cleanup();
  }
});
