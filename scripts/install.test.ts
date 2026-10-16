// install (傘下スキルの導入) を CLI の外から確かめる。取得元は一時ディレクトリに作ったローカルの git リポジトリ
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli, tempEnv } from "./test-helper.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 応答の JSON をオブジェクトとして読む
function payload(json: unknown): Record<string, unknown> {
  if (!isRecord(json)) throw new Error(`JSON がオブジェクトではありません: ${JSON.stringify(json)}`);
  return json;
}

// 応答の中のオブジェクトの配列 (plan・installed・skipped・manual・entries) を読む
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`配列ではありません: ${JSON.stringify(value)}`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`要素がオブジェクトではありません: ${JSON.stringify(item)}`);
    return item;
  });
}

// 文字列の配列 (commands) を読む
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error(`配列ではありません: ${JSON.stringify(value)}`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`要素が文字列ではありません: ${JSON.stringify(item)}`);
    return item;
  });
}

// 応答の plan を読む
function planOf(json: unknown): Record<string, unknown>[] {
  return records(payload(json).plan);
}

// 置かれたファイルを読む。git の改行の変換 (CRLF) を除いて比べる
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

// テストの中の git。失敗したらテストを止める
function git(cwd: string, args: string[]): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return (res.stdout ?? "").trim();
}

const commit = (cwd: string, message: string): void => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", message]);
};

// <base>/owner/fake.git に、スキルを skills/fake-skill/ と直下 (SKILL.md・README.md) に持つリポジトリを作る。
// 固定コミット (first) のあとに 2 つ目のコミットで中身を変え、返す ref は固定コミットの SHA
function makeRepo(dir: string): { base: string; ref: string } {
  const base = join(dir, "base");
  const work = join(dir, "work");
  const bare = join(base, "owner", "fake.git");
  const skill = join(work, "skills", "fake-skill");
  mkdirSync(work, { recursive: true });
  mkdirSync(join(base, "owner"), { recursive: true });
  git(work, ["init"]);
  writeFileSync(join(work, "SKILL.md"), "# fake-root\n\nfixed\n", "utf8");
  writeFileSync(join(work, "README.md"), "readme\n", "utf8");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# fake-skill\n\nfixed\n", "utf8");
  writeFileSync(join(skill, "extra.txt"), "extra\n", "utf8");
  commit(work, "first");
  const ref = git(work, ["rev-parse", "HEAD"]);
  writeFileSync(join(work, "SKILL.md"), "# fake-root\n\nchanged\n", "utf8");
  writeFileSync(join(skill, "SKILL.md"), "# fake-skill\n\nchanged\n", "utf8");
  commit(work, "second");
  git(work, ["init", "--bare", bare]);
  git(work, ["push", bare, "HEAD:refs/heads/main"]);
  git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { base, ref };
}

// 同梱の 1 件を、追加台帳に書ける形 (installed・enabled・origin を除く) で写す
function baseEntry(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const res = runCli(["catalog"], env);
  assert.equal(res.code, 0, res.stderr);
  const entry = records(payload(res.json).entries)[0];
  assert.ok(entry !== undefined);
  const copy: Record<string, unknown> = { ...entry };
  delete copy.installed;
  delete copy.enabled;
  delete copy.origin;
  return copy;
}

// 追加台帳の 1 件。id・取得元・前提だけを差し替える
function localEntry(base: Record<string, unknown>, id: string, source: Record<string, unknown>): Record<string, unknown> {
  return { ...base, id, name: id, source, prerequisites: [], notes: [], invokeFlags: [] };
}

function writeCatalog(env: NodeJS.ProcessEnv, entries: Record<string, unknown>[]): void {
  const home = env.DESIGN_STUDIO_HOME;
  assert.ok(home !== undefined, "DESIGN_STUDIO_HOME がありません");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "catalog.local.json"), JSON.stringify(entries, null, 2) + "\n", "utf8");
}

// 存在しないコミット (40 桁。台帳の検証は通る)
const BAD_REF = "1111111111111111111111111111111111111111";

type Fixture = { dir: string; env: NodeJS.ProcessEnv; skills: string; ref: string; cleanup: () => void };

// 一時ディレクトリに取得元のリポジトリと追加台帳 (fake-skill・fake-root・fake-bad) を用意する
function makeCase(): Fixture {
  const t = tempEnv();
  const { base, ref } = makeRepo(t.dir);
  const env: NodeJS.ProcessEnv = { ...t.env, DESIGN_STUDIO_GITHUB_BASE: base };
  const bundled = baseEntry(env);
  const source = (path: string, sha: string): Record<string, unknown> => ({ type: "github", repo: "owner/fake", path, ref: sha });
  writeCatalog(env, [
    localEntry(bundled, "fake-skill", source("skills/fake-skill", ref)),
    localEntry(bundled, "fake-root", source(".", ref)),
    localEntry(bundled, "fake-bad", source("skills/fake-skill", BAD_REF)),
  ]);
  return { dir: t.dir, env, skills: join(t.dir, "skills"), ref, cleanup: t.cleanup };
}

// リンクの的。"{outside}" はクローンの外のファイル、"{missing}" は存在しないパス。それ以外はそのまま
function resolveTarget(dir: string, target: string): string {
  if (target === "{outside}") return join(dir, "outside-secret.txt");
  if (target === "{missing}") return join(dir, "no-such-target.txt");
  return target;
}

const isPermissionError = (e: unknown): boolean => isRecord(e) && e.code === "EPERM";

type RepoFile = { path: string; content: string };
type RepoLink = { path: string; target: string };

// シンボリックリンクを含むリポジトリを <base>/owner/<name>.git に作る。リンクを作れない環境では null
function makeLinkRepo(dir: string, name: string, files: RepoFile[], links: RepoLink[]): { base: string; ref: string } | null {
  const base = join(dir, "base");
  const work = join(dir, `work-${name}`);
  const bare = join(base, "owner", `${name}.git`);
  mkdirSync(work, { recursive: true });
  mkdirSync(join(base, "owner"), { recursive: true });
  git(work, ["init"]);
  git(work, ["config", "core.symlinks", "true"]);
  writeFileSync(join(work, "SKILL.md"), `# ${name}\n\nfixed\n`, "utf8");
  for (const file of files) {
    const path = join(work, ...file.path.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, "utf8");
  }
  for (const link of links) {
    const path = join(work, ...link.path.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    try {
      symlinkSync(resolveTarget(dir, link.target), path, "file");
    } catch (e) {
      if (!isPermissionError(e)) throw e;
      return null;
    }
  }
  commit(work, "first");
  const ref = git(work, ["rev-parse", "HEAD"]);
  git(work, ["init", "--bare", bare]);
  git(work, ["push", bare, "HEAD:refs/heads/main"]);
  git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { base, ref };
}

// リンクを持つ取得元と、その id だけの追加台帳を用意する。checkout で本物のリンクを作らせる
// (core.symlinks)。リンクを作れない環境 (EPERM) では null (テストは skip する)
function makeSymlinkCase(id: string, path: string, files: RepoFile[], links: RepoLink[]): Fixture | null {
  const t = tempEnv();
  writeFileSync(join(t.dir, "outside-secret.txt"), "SECRET-OUTSIDE\n", "utf8");
  const repo = makeLinkRepo(t.dir, id, files, links);
  if (repo === null) {
    t.cleanup();
    return null;
  }
  const env: NodeJS.ProcessEnv = {
    ...t.env,
    DESIGN_STUDIO_GITHUB_BASE: repo.base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.symlinks",
    GIT_CONFIG_VALUE_0: "true",
  };
  const bundled = baseEntry(env);
  writeCatalog(env, [localEntry(bundled, id, { type: "github", repo: `owner/${id}`, path, ref: repo.ref })]);
  return { dir: t.dir, env, skills: join(t.dir, "skills"), ref: repo.ref, cleanup: t.cleanup };
}

// 偽 git にする node スクリプト。受け取った env の 2 つを標準エラーに書いて、失敗 (1) で終わる
const FAKE_GIT = [
  'process.stderr.write(`GIT_TERMINAL_PROMPT=${process.env.GIT_TERMINAL_PROMPT ?? ""}\\n`);',
  'process.stderr.write(`GCM_INTERACTIVE=${process.env.GCM_INTERACTIVE ?? ""}\\n`);',
  "process.exit(1);",
].join("\n");

// 標準エラーの JSON を読む (壊れていれば null)
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// カレントディレクトリを移して CLI を起動する。DESIGN_STUDIO_GIT に node を向けると、git の
// 1 つ目の引数 (clone) と同じ名前のスクリプトを node がこのディレクトリから読む。.cmd は
// シェルを通さない spawn では起動できないため、node で動くスクリプトを向ける
function runCliInWorkDir(dir: string, args: string[], env: NodeJS.ProcessEnv): { code: number; stderr: string } {
  const studio = fileURLToPath(new URL("./studio.ts", import.meta.url));
  const res = spawnSync(process.execPath, [studio, ...args], { cwd: dir, env, encoding: "utf8" });
  return { code: res.status ?? -1, stderr: res.stderr ?? "" };
}

void test("plan は ids を省くと台帳の全件、--ids ではその id だけを返す", () => {
  const c = makeCase();
  try {
    const all = planOf(runCli(["install", "--plan"], c.env).json);
    assert.equal(all.length, 12 + 3);
    const ids = all.map((item) => item.id);
    for (const id of ["fake-skill", "fake-root", "fake-bad"]) assert.ok(ids.includes(id), id);
    const one = planOf(runCli(["install", "--plan", "--ids", "fake-skill"], c.env).json);
    assert.deepEqual(
      one.map((item) => item.id),
      ["fake-skill"],
    );
    // plan は何も置かない
    assert.equal(existsSync(join(c.skills, "fake-skill")), false);
  } finally {
    c.cleanup();
  }
});

void test("github の未導入は clone で、to はスキル置き場の <id>", () => {
  const c = makeCase();
  try {
    const plan = planOf(runCli(["install", "--plan", "--ids", "fake-skill"], c.env).json);
    const item = plan[0];
    assert.ok(item !== undefined);
    assert.equal(item.action, "clone");
    assert.equal(item.to, join(c.skills, "fake-skill"));
    const source = item.source;
    assert.ok(isRecord(source));
    assert.equal(source.type, "github");
    assert.equal(source.repo, "owner/fake");
    assert.equal(source.ref, c.ref);
    assert.deepEqual(strings(item.commands), []);
  } finally {
    c.cleanup();
  }
});

void test("apply は固定コミットの中身を置き、.git は置かない", () => {
  const c = makeCase();
  try {
    const res = runCli(["install", "--apply", "--ids", "fake-skill"], c.env);
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.deepEqual(records(json.installed), [{ id: "fake-skill", to: join(c.skills, "fake-skill"), ref: c.ref }]);
    assert.deepEqual(records(json.skipped), []);
    assert.deepEqual(records(json.manual), []);
    const dir = join(c.skills, "fake-skill");
    // 固定コミットのあとに足した変更 (changed) は入っていない
    assert.equal(readText(join(dir, "SKILL.md")), "# fake-skill\n\nfixed\n");
    assert.equal(readText(join(dir, "extra.txt")), "extra\n");
    assert.equal(existsSync(join(dir, ".git")), false);
  } finally {
    c.cleanup();
  }
});

void test("path が . の項目は、固定コミットのリポジトリ全体が置かれる", () => {
  const c = makeCase();
  try {
    const res = runCli(["install", "--apply", "--ids", "fake-root"], c.env);
    assert.equal(res.code, 0, res.stderr);
    const dir = join(c.skills, "fake-root");
    assert.equal(readText(join(dir, "SKILL.md")), "# fake-root\n\nfixed\n");
    assert.equal(readText(join(dir, "README.md")), "readme\n");
    assert.equal(readText(join(dir, "skills", "fake-skill", "SKILL.md")), "# fake-skill\n\nfixed\n");
    // path が "." のときはクローンのまま (.git 付き) 置いてよい
    assert.equal(existsSync(join(dir, ".git")), true);
  } finally {
    c.cleanup();
  }
});

void test("2 回目の apply は exists で skipped になり、置いたあとの変更は残る", () => {
  const c = makeCase();
  try {
    const first = runCli(["install", "--apply", "--ids", "fake-skill,fake-root"], c.env);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(
      records(payload(first.json).installed).map((item) => item.id),
      ["fake-skill", "fake-root"],
    );

    // 利用者が置いたあとに手を入れた形にする。2 回目が上書きしたら、この中身は消える
    const file = join(c.skills, "fake-skill", "SKILL.md");
    writeFileSync(file, "# fake-skill\n\nlocal edit\n", "utf8");

    const second = runCli(["install", "--apply", "--ids", "fake-skill,fake-root"], c.env);
    assert.equal(second.code, 0, second.stderr);
    const json = payload(second.json);
    assert.deepEqual(records(json.installed), []);
    assert.deepEqual(
      records(json.skipped).map((item) => [item.id, item.reason]),
      [
        ["fake-skill", "exists"],
        ["fake-root", "exists"],
      ],
    );
    assert.equal(readText(file), "# fake-skill\n\nlocal edit\n");

    const plan = planOf(runCli(["install", "--plan", "--ids", "fake-skill"], c.env).json);
    assert.equal(plan[0]?.action, "installed");
  } finally {
    c.cleanup();
  }
});

void test("SKILL.md の無い既存の置き先は、上書きせず exists で skipped になる", () => {
  const c = makeCase();
  try {
    // 利用者が先に置いたディレクトリ。SKILL.md が無いので、計画では未導入に見える
    const dir = join(c.skills, "fake-skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "keep.txt"), "keep\n", "utf8");

    const plan = planOf(runCli(["install", "--plan", "--ids", "fake-skill"], c.env).json);
    assert.equal(plan[0]?.action, "clone");

    const res = runCli(["install", "--apply", "--ids", "fake-skill"], c.env);
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.deepEqual(records(json.installed), []);
    assert.deepEqual(
      records(json.skipped).map((item) => [item.id, item.reason]),
      [["fake-skill", "exists"]],
    );
    // 既にあったディレクトリはそのまま残り、ほかのファイルも増えない
    // (置く途中の失敗で消すのは、この apply で作った置き先だけ)
    assert.equal(readText(join(dir, "keep.txt")), "keep\n");
    assert.deepEqual(readdirSync(dir), ["keep.txt"]);
  } finally {
    c.cleanup();
  }
});

void test("plugin の項目は manual で、入れるコマンドを返す (実行はしない)", () => {
  const c = makeCase();
  try {
    const plan = planOf(runCli(["install", "--plan", "--ids", "design-critique"], c.env).json);
    const item = plan[0];
    assert.ok(item !== undefined);
    assert.equal(item.action, "manual");
    assert.equal(item.to, null);
    assert.ok(strings(item.commands).includes("/plugin install design@claude.ai"));

    const res = runCli(["install", "--apply", "--ids", "design-critique"], c.env);
    assert.equal(res.code, 0, res.stderr);
    const json = payload(res.json);
    assert.deepEqual(records(json.installed), []);
    assert.deepEqual(records(json.skipped), []);
    assert.deepEqual(
      records(json.manual).map((entry) => entry.id),
      ["design-critique"],
    );
    assert.equal(existsSync(join(c.skills, "design-critique")), false);
  } finally {
    c.cleanup();
  }
});

void test("prerequisites のコマンドは plan の commands に入る", () => {
  const c = makeCase();
  try {
    const plan = planOf(runCli(["install", "--plan", "--ids", "playwright-cli"], c.env).json);
    const item = plan[0];
    assert.ok(item !== undefined);
    assert.equal(item.action, "clone");
    assert.ok(strings(item.commands).includes("npm i -g @playwright/cli@latest"));
  } finally {
    c.cleanup();
  }
});

void test("存在しない ref は git-failed の終了コード 3 になり、置き先は残らない", () => {
  const c = makeCase();
  try {
    const res = runCli(["install", "--apply", "--ids", "fake-bad"], c.env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(res.json);
    assert.equal(json.error, "git-failed");
    assert.equal(json.id, "fake-bad");
    assert.equal(existsSync(join(c.skills, "fake-bad")), false);
  } finally {
    c.cleanup();
  }
});

void test("引数の誤りは終了コード 1", () => {
  const c = makeCase();
  try {
    const bad: string[][] = [
      ["install"],
      ["install", "--apply"],
      ["install", "--apply", "--ids", "nope"],
      ["install", "--plan", "--apply", "--ids", "fake-skill"],
      ["install", "--plan", "--ids", "nope"],
      ["install", "--plan", "--bogus"],
      ["install", "--apply", "--ids", "fake-skill", "--bogus"],
    ];
    for (const args of bad) {
      const res = runCli(args, c.env);
      assert.equal(res.code, 1, `${args.join(" ")}: ${res.stderr}`);
    }
  } finally {
    c.cleanup();
  }
});

void test("置き先の外を指す id は 1 で止まり、外へは書かない", () => {
  const c = makeCase();
  try {
    for (const id of ["../evil", "..\\evil", "a/b"]) {
      const res = runCli(["install", "--apply", "--ids", id], c.env);
      assert.equal(res.code, 1, `${id}: ${res.stderr}`);
      assert.equal(payload(res.json).error, "input", id);
    }
    assert.equal(existsSync(join(c.dir, "evil")), false);
    assert.equal(existsSync(join(c.dir, "skills", "a")), false);
  } finally {
    c.cleanup();
  }
});

void test("クローンの外を指すリンクがある取得元は、何も置かずに unsafe-symlink で止める", (t) => {
  const c = makeSymlinkCase(
    "leak-inner",
    "skills/leaky-skill",
    [{ path: "skills/leaky-skill/SKILL.md", content: "# leaky\n\nfixed\n" }],
    [{ path: "skills/leaky-skill/leak.txt", target: "{outside}" }],
  );
  if (c === null) {
    t.skip("この環境ではシンボリックリンクを作れません");
    return;
  }
  try {
    const res = runCli(["install", "--apply", "--ids", "leak-inner"], c.env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(res.json);
    assert.equal(json.error, "unsafe-symlink");
    assert.equal(json.id, "leak-inner");
    assert.equal(json.path, "skills/leaky-skill/leak.txt");
    assert.equal(existsSync(join(c.skills, "leak-inner")), false);
  } finally {
    c.cleanup();
  }
});

void test("path が . (クローンの根が起点) でも、外を指すリンクで止める", (t) => {
  const c = makeSymlinkCase("leak-root", ".", [], [{ path: "leak.txt", target: "{outside}" }]);
  if (c === null) {
    t.skip("この環境ではシンボリックリンクを作れません");
    return;
  }
  try {
    const res = runCli(["install", "--apply", "--ids", "leak-root"], c.env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(res.json);
    assert.equal(json.error, "unsafe-symlink");
    assert.equal(json.id, "leak-root");
    assert.equal(json.path, "leak.txt");
    assert.equal(existsSync(join(c.skills, "leak-root")), false);
  } finally {
    c.cleanup();
  }
});

void test("コピーの起点 (path) がクローンの外を指すリンクのときも、止める", (t) => {
  const c = makeSymlinkCase("leak-start", "leakdir", [], [{ path: "leakdir", target: "{outside}" }]);
  if (c === null) {
    t.skip("この環境ではシンボリックリンクを作れません");
    return;
  }
  try {
    const res = runCli(["install", "--apply", "--ids", "leak-start"], c.env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(res.json);
    assert.equal(json.error, "unsafe-symlink");
    assert.equal(json.id, "leak-start");
    assert.equal(json.path, "leakdir");
    assert.equal(existsSync(join(c.skills, "leak-start")), false);
  } finally {
    c.cleanup();
  }
});

void test("解けない壊れたリンクも、クローンの外とみなして止める", (t) => {
  const c = makeSymlinkCase(
    "leak-dead",
    "skills/dead-skill",
    [{ path: "skills/dead-skill/SKILL.md", content: "# dead\n\nfixed\n" }],
    [{ path: "skills/dead-skill/dead.txt", target: "{missing}" }],
  );
  if (c === null) {
    t.skip("この環境ではシンボリックリンクを作れません");
    return;
  }
  try {
    const res = runCli(["install", "--apply", "--ids", "leak-dead"], c.env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(res.json);
    assert.equal(json.error, "unsafe-symlink");
    assert.equal(json.id, "leak-dead");
    assert.equal(json.path, "skills/dead-skill/dead.txt");
    assert.equal(existsSync(join(c.skills, "leak-dead")), false);
  } finally {
    c.cleanup();
  }
});

void test("起点の下に収まるリンクは、今までどおりファイルとして置かれる", (t) => {
  const c = makeSymlinkCase(
    "link-ok",
    "skills/ok-skill",
    [
      { path: "skills/ok-skill/SKILL.md", content: "# ok\n\nfixed\n" },
      { path: "skills/ok-skill/extra.txt", content: "extra\n" },
    ],
    [{ path: "skills/ok-skill/alias.txt", target: "extra.txt" }],
  );
  if (c === null) {
    t.skip("この環境ではシンボリックリンクを作れません");
    return;
  }
  try {
    const res = runCli(["install", "--apply", "--ids", "link-ok"], c.env);
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(
      records(payload(res.json).installed).map((item) => item.id),
      ["link-ok"],
    );
    const dir = join(c.skills, "link-ok");
    assert.equal(readText(join(dir, "SKILL.md")), "# ok\n\nfixed\n");
    assert.equal(readText(join(dir, "alias.txt")), "extra\n");
  } finally {
    c.cleanup();
  }
});

void test("git には対話を止める設定を渡し、git の失敗は git-failed にする", () => {
  const c = makeCase();
  try {
    // 偽 git を置いたディレクトリで CLI を起動する (1 つ目の引数 clone を node が読む)
    const fake = join(c.dir, "fake-git");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "clone"), FAKE_GIT, "utf8");
    const env: NodeJS.ProcessEnv = {
      ...c.env,
      DESIGN_STUDIO_GIT: process.execPath,
      // 呼び出し元の値ではなく、実装が入れる 0 と never が必ず渡ること
      GIT_TERMINAL_PROMPT: "1",
      GCM_INTERACTIVE: "auto",
    };
    const res = runCliInWorkDir(fake, ["install", "--apply", "--ids", "fake-skill"], env);
    assert.equal(res.code, 3, res.stderr);
    const json = payload(parseJsonText(res.stderr));
    assert.equal(json.error, "git-failed");
    assert.equal(json.id, "fake-skill");
    const stderr = json.stderr;
    assert.ok(typeof stderr === "string", JSON.stringify(json));
    assert.ok(stderr.includes("GIT_TERMINAL_PROMPT=0"), stderr);
    assert.ok(stderr.includes("GCM_INTERACTIVE=never"), stderr);
    assert.equal(existsSync(join(c.skills, "fake-skill")), false);

    // 起動できない git も git-failed になる (result.error)
    const missing = runCliInWorkDir(fake, ["install", "--apply", "--ids", "fake-skill"], {
      ...c.env,
      DESIGN_STUDIO_GIT: join(c.dir, "no-such-git"),
    });
    assert.equal(missing.code, 3, missing.stderr);
    const missingJson = payload(parseJsonText(missing.stderr));
    assert.equal(missingJson.error, "git-failed");
    assert.equal(missingJson.id, "fake-skill");
  } finally {
    c.cleanup();
  }
});
