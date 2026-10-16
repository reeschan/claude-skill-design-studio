// 台帳に載っている傘下スキルを、取得元 (GitHub のリポジトリ・パス・固定コミット) から
// スキル置き場 (<skillsDir>/<id>) へ入れる。何をどこへ置くかを planInstall で先に返し、
// 確認のあとに applyInstall で実行する。plugin と PC 全体に効く前提はコマンドを示すだけにする
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { CliExit, EXIT_EXTERNAL, EXIT_INPUT } from "./cli-exit.ts";
import { isInstalled, listCatalog } from "./catalog.ts";
import { githubBase, gitCommand, skillsDir } from "./paths.ts";
import type { CatalogEntry, CatalogSource } from "./types.ts";

/** 1 件の計画。action は clone (これから置く)・installed (導入済み)・manual (利用者が入れる) */
export type PlanItem = {
  id: string;
  name: string;
  action: "clone" | "installed" | "manual";
  source: CatalogSource;
  to: string | null;
  commands: string[]; // 利用者が自分で実行するコマンド (プラグインの導入と、prerequisites)
};

/** applyInstall の結果。manual は実行せず、計画のまま返す */
export type ApplyResult = {
  installed: { id: string; to: string; ref: string }[];
  skipped: { id: string; reason: string }[];
  manual: PlanItem[];
};

type GithubSource = Extract<CatalogSource, { type: "github" }>;
type GithubEntry = CatalogEntry & { source: GithubSource };

const isGithubEntry = (entry: CatalogEntry): entry is GithubEntry => entry.source.type === "github";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const invalid = (message: string, id: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message, id });

// id は置き先のディレクトリ名になる。`/` `\` `..` を含む id は置き先の外を指すため拒む
function checkId(id: string): void {
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw invalid(`id に置き先の外を指す文字が含まれています: ${id}`, id);
  }
}

// 台帳から 1 件引く。無ければ入力の誤り (利用者が id を間違えた)
function entryOf(catalog: CatalogEntry[], id: string): CatalogEntry {
  const entry = catalog.find((item) => item.id === id);
  if (entry === undefined) throw invalid(`知らない id です: ${id}`, id);
  return entry;
}

// 利用者が実行するコマンドを先頭に足す。同じ文字列 (prerequisites にもあるもの) は重ねない
function addCommand(commands: string[], command: string): string[] {
  return commands.includes(command) ? commands : [command, ...commands];
}

function planItem(entry: CatalogEntry, env: NodeJS.ProcessEnv): PlanItem {
  const commands = entry.prerequisites.map((item) => item.command);
  if (isInstalled(entry, env)) {
    return { id: entry.id, name: entry.name, action: "installed", source: entry.source, to: null, commands };
  }
  if (entry.source.type === "plugin") {
    const { plugin, marketplace } = entry.source;
    const command = `/plugin install ${plugin}@${marketplace}`;
    return { id: entry.id, name: entry.name, action: "manual", source: entry.source, to: null, commands: addCommand(commands, command) };
  }
  return { id: entry.id, name: entry.name, action: "clone", source: entry.source, to: join(skillsDir(env), entry.id), commands };
}

// 計画と、その元になった台帳の 1 件の組
type PlannedEntry = { entry: CatalogEntry; item: PlanItem };

function planEntries(env: NodeJS.ProcessEnv, ids?: string[]): PlannedEntry[] {
  const catalog = listCatalog(env);
  if (ids === undefined) return catalog.map((entry) => ({ entry, item: planItem(entry, env) }));
  return ids.map((id) => {
    checkId(id);
    const entry = entryOf(catalog, id);
    return { entry, item: planItem(entry, env) };
  });
}

/** 台帳の id ごとに、何をどこへ置くかを返す。ids を省くと台帳の全件 */
export function planInstall(env: NodeJS.ProcessEnv, ids?: string[]): PlanItem[] {
  return planEntries(env, ids).map((planned) => planned.item);
}

// git に与える上限の時間 (ミリ秒)。資格情報の確認などで返らなくなるのを防ぐ
const GIT_TIMEOUT_MS = 120000;

// git の子プロセスの環境。対話 (資格情報の確認) で止まらないよう、この 2 つは必ず入れる
function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

// git を引数の配列で呼ぶ (シェルを通さない)。起動できない・時間切れも外部の失敗 (3) にする
function runGit(env: NodeJS.ProcessEnv, id: string, args: string[], cwd?: string): void {
  const result = spawnSync(gitCommand(env), args, { cwd, env: gitEnv(env), encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (result.error === undefined && result.status === 0) return;
  const stderr = result.stderr ?? "";
  if (result.error !== undefined) {
    throw new CliExit(EXIT_EXTERNAL, {
      error: "git-failed",
      id,
      stderr: `${stderr}git を起動できなかったか、時間切れで終わりませんでした (${result.error.message})\n`,
    });
  }
  if (result.status === null)
    throw new CliExit(EXIT_EXTERNAL, { error: "git-failed", id, stderr: `${stderr}git が時間切れで終わりませんでした\n` });
  throw new CliExit(EXIT_EXTERNAL, { error: "git-failed", id, stderr });
}

// 解いたパスが root の中 (root 自身を含む) か
function isInside(root: string, resolved: string): boolean {
  const rel = relative(root, resolved);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

// 実パスに解く。解けない (壊れたリンク・無い) ときは null
function tryRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// シンボリックリンクそのものか。無いときは false
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// cloneDir からの各区間を順に見て、最初のシンボリックリンクの相対パスを返す
function firstSymlink(cloneDir: string, segments: string[]): string | null {
  for (let i = 0; i < segments.length; i += 1) {
    if (isSymlink(join(cloneDir, ...segments.slice(0, i + 1)))) return segments.slice(0, i + 1).join("/");
  }
  return null;
}

// クローンの外を指すリンク。何も置かずに止める (利用者のファイルを写さない)
function unsafeSymlink(id: string, path: string): CliExit {
  return new CliExit(EXIT_EXTERNAL, { error: "unsafe-symlink", id, path });
}

// コピーの起点を実パスに解く。解けない・クローンの外を指すときは、リンクを報告して止める
function resolveStart(id: string, cloneDir: string, segments: string[]): string {
  const start = segments.length === 0 ? cloneDir : join(cloneDir, ...segments);
  const resolved = tryRealpath(start);
  if (resolved !== null && isInside(realpathSync(cloneDir), resolved)) return resolved;
  throw unsafeSymlink(id, firstSymlink(cloneDir, segments) ?? segments.join("/"));
}

// 置くツリー (.git の中は見ない) を lstat でたどり、起点の外を指すリンクがあれば止める。
// 壊れたリンクも外とみなす。リンクのディレクトリはたどらない
function checkTreeLinks(id: string, root: string, dir: string, relBase: string): void {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const full = join(dir, name);
    const rel = relBase === "" ? name : `${relBase}/${name}`;
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) {
      const resolved = tryRealpath(full);
      if (resolved === null || !isInside(root, resolved)) throw unsafeSymlink(id, rel);
    } else if (stats.isDirectory()) {
      checkTreeLinks(id, root, full, rel);
    }
  }
}

// 置く前の安全確認。コピーの起点もツリーの中のリンクも、クローンの外を指していたら止める
function assertSafePlacement(id: string, cloneDir: string, path: string): void {
  const segments = path === "." ? [] : path.split("/");
  const start = resolveStart(id, cloneDir, segments);
  // リンクの報告は、設定された path からの相対 (クローン内の相対パス) にする
  checkTreeLinks(id, start, start, segments.join("/"));
}

// from の中身を to へ写す (to は作る)。スキルに要らない `.git` は持って行かない
function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const child of readdirSync(from, { withFileTypes: true })) {
    if (child.name === ".git") continue;
    const source = join(from, child.name);
    const target = join(to, child.name);
    if (child.isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}

// rename で移す。別ドライブ (EXDEV) などで移せないときは写してから消す
function moveTree(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

// 一時クローンの中身を置き先へ置く。path が "." ならクローンごと (`.git` 付きで) 移し、
// そうでなければその下のディレクトリだけを写す
function placeClone(source: GithubSource, cloneDir: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  if (source.path === ".") {
    moveTree(cloneDir, to);
    return;
  }
  copyTree(join(cloneDir, ...source.path.split("/")), to);
}

// 1 件を実際に置く。git の失敗はそのまま返し、置く途中で失敗したら置き先を消してから止める
function installClone(env: NodeJS.ProcessEnv, entry: GithubEntry, to: string): void {
  const temp = mkdtempSync(join(tmpdir(), "design-studio-install-"));
  try {
    const cloneDir = join(temp, "clone");
    runGit(env, entry.id, ["clone", `${githubBase(env)}/${entry.source.repo}.git`, cloneDir]);
    runGit(env, entry.id, ["checkout", entry.source.ref], cloneDir);
    try {
      // クローンの外のファイルを写してしまわないように、置く前にリンクを確かめる
      assertSafePlacement(entry.id, cloneDir, entry.source.path);
      placeClone(entry.source, cloneDir, to);
    } catch (e) {
      // ここで消してよいのは、この apply で作った置き先だけ (既にあるディレクトリは plan で除く)
      rmSync(to, { recursive: true, force: true });
      if (e instanceof CliExit) throw e;
      throw new CliExit(EXIT_EXTERNAL, { error: "install-failed", id: entry.id, message: errorMessage(e) });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** clone の項目だけを実行する。置き先が既にあれば上書きせず skipped (reason "exists") */
export function applyInstall(env: NodeJS.ProcessEnv, ids: string[]): Promise<ApplyResult> {
  const result: ApplyResult = { installed: [], skipped: [], manual: [] };
  for (const { entry, item } of planEntries(env, ids)) {
    if (item.action === "manual") {
      // プラグインと前提は実行しない。入れるコマンドを示すだけ
      result.manual.push(item);
    } else if (item.action !== "clone" || !isGithubEntry(entry) || item.to === null || existsSync(item.to)) {
      // 導入済みの項目と、置き先が既にある項目は上書きしない
      result.skipped.push({ id: item.id, reason: "exists" });
    } else {
      installClone(env, entry, item.to);
      result.installed.push({ id: item.id, to: item.to, ref: entry.source.ref });
    }
  }
  return Promise.resolve(result);
}
