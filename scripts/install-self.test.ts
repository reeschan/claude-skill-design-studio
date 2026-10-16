// install-self (開発用リポジトリから ~/.claude/skills/design-studio への写し) を CLI の外から確かめる
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tempEnv } from "./test-helper.ts";

// 開発用リポジトリのルート (このテストの 1 つ上)
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
// 目印。install-self が書く
const MARKER = ".design-studio-install";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 応答の中の文字列の配列を読む
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error(`配列ではありません: ${JSON.stringify(value)}`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`要素が文字列ではありません: ${JSON.stringify(item)}`);
    return item;
  });
}

// 出力の JSON を読む (空・壊れていれば null)
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// 改行の変換 (CRLF) を除いて読む
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

// dir の下のファイルを、dir からの相対 (区切りは "/") で全部集める
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

// 相対パス (区切りは "/") を OS のパスに直す
const at = (dir: string, rel: string): string => join(dir, ...rel.split("/"));

type CliResult = { code: number; json: unknown };

// install-self を子プロセスで起動する
function runInstall(env: NodeJS.ProcessEnv): CliResult {
  const res = spawnSync(process.execPath, ["scripts/install-self.ts"], { cwd: REPO_ROOT, env, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { code: res.status ?? -1, json: parseJson(stdout) ?? parseJson(stderr) };
}

type Fixture = { dir: string; dest: string; env: NodeJS.ProcessEnv; cleanup: () => void };

// 一時ディレクトリを作り、置き先 (DESIGN_STUDIO_INSTALL_DIR) をその下に向ける
function makeCase(): Fixture {
  const t = tempEnv();
  const dest = join(t.dir, "install");
  return { dir: t.dir, dest, env: { ...t.env, DESIGN_STUDIO_INSTALL_DIR: dest }, cleanup: t.cleanup };
}

void test("新規の置き先に一式を写し、目印と {dir, files} を残す", () => {
  const c = makeCase();
  try {
    const res = runInstall(c.env);
    assert.equal(res.code, 0, JSON.stringify(res.json));
    const json = payload(res.json);
    assert.equal(json.dir, c.dest);

    const required = [
      "SKILL.md",
      "README.md",
      "CONTEXT.md",
      "package.json",
      "scripts/studio.ts",
      "core/cli-exit.ts",
      "skeletons/index.ts",
      "data/catalog.json",
      "data/styles.json",
      "docs/page-recipe.md",
    ];
    for (const rel of required) assert.ok(existsSync(at(c.dest, rel)), `${rel} がありません`);

    // app/server.ts と app/index.html は、並列の PBI-013 が作る。写す元に無いときは確かめようがないので省く
    for (const rel of ["app/server.ts", "app/index.html"]) {
      if (!existsSync(at(REPO_ROOT, rel))) continue;
      assert.ok(existsSync(at(c.dest, rel)), `${rel} がありません`);
    }

    // 目印には、写した日時とコミットが入る
    const marker = payload(parseJson(readText(at(c.dest, MARKER))));
    const installedAt = marker.installedAt;
    const commit = marker.commit;
    assert.ok(typeof installedAt === "string" && installedAt !== "", "installedAt がありません");
    assert.ok(typeof commit === "string" && commit !== "", "commit がありません");

    // 開発用のファイルは写らない
    assert.deepEqual(
      walk(c.dest).filter((rel) => rel.endsWith(".test.ts")),
      [],
    );
    for (const rel of ["scripts/test-helper.ts", "app/mock-llm.mjs", "test", "docs/pbi", "node_modules"]) {
      assert.equal(existsSync(at(c.dest, rel)), false, `${rel} があります`);
    }

    // files の一覧も同じ約束
    const files = strings(json.files);
    for (const rel of ["SKILL.md", "scripts/studio.ts", "docs/page-recipe.md"])
      assert.ok(files.includes(rel), `${rel} が files にありません`);
    assert.deepEqual(
      files.filter((rel) => rel.endsWith(".test.ts")),
      [],
    );
    assert.equal(files.includes("scripts/test-helper.ts"), false);
    assert.equal(files.includes("app/mock-llm.mjs"), false);
  } finally {
    c.cleanup();
  }
});

void test("目印のある置き先は写し直し、前回だけのファイルを残さない", () => {
  const c = makeCase();
  try {
    assert.equal(runInstall(c.env).code, 0);
    writeFileSync(at(c.dest, "stale.txt"), "stale\n", "utf8");
    writeFileSync(at(c.dest, "SKILL.md"), "壊れた中身\n", "utf8");

    const res = runInstall(c.env);
    assert.equal(res.code, 0, JSON.stringify(res.json));
    assert.equal(existsSync(at(c.dest, "stale.txt")), false, "前回だけのファイルが残っています");
    assert.equal(readText(at(c.dest, "SKILL.md")), readText(at(REPO_ROOT, "SKILL.md")));
  } finally {
    c.cleanup();
  }
});

void test("目印の無い既存のディレクトリには書かず、終了コード 2", () => {
  const c = makeCase();
  try {
    mkdirSync(c.dest, { recursive: true });
    writeFileSync(at(c.dest, "keep.txt"), "keep\n", "utf8");

    const res = runInstall(c.env);
    assert.equal(res.code, 2, JSON.stringify(res.json));
    const json = payload(res.json);
    assert.equal(json.error, "marker-missing");
    assert.equal(json.dir, c.dest);
    assert.deepEqual(readdirSync(c.dest), ["keep.txt"]);
  } finally {
    c.cleanup();
  }
});

void test("写した先の studio.ts が styles で動く", () => {
  const c = makeCase();
  try {
    assert.equal(runInstall(c.env).code, 0);
    const env: NodeJS.ProcessEnv = { ...c.env, DESIGN_STUDIO_HOME: join(c.dir, "run-home") };
    const res = spawnSync(process.execPath, [at(c.dest, "scripts/studio.ts"), "styles"], { cwd: c.dest, env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    const json = payload(parseJson(res.stdout ?? ""));
    assert.ok(Array.isArray(json.styles) && json.styles.length > 0, JSON.stringify(json));
  } finally {
    c.cleanup();
  }
});
