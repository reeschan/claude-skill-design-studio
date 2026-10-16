// design-studio の自己インストール。開発用リポジトリの中身から、スキルとして使う分だけを
// <DESIGN_STUDIO_INSTALL_DIR> (既定 ~/.claude/skills/design-studio) へ写す。
// 目印 (.design-studio-install) のある置き先だけを、消してから写し直す。
// 結果は JSON を 1 つ標準出力に出す ({dir, files})。エラーは標準エラーに {"error": ...} を 1 行
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExit, EXIT_ACTION, EXIT_INPUT, EXIT_OK, usage } from "../core/cli-exit.ts";
import { expandHome, gitCommand } from "../core/paths.ts";

// scripts/install-self.ts の 1 つ上 = 開発用リポジトリのルート
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
// 置き先の目印。中身は写した日時と、写す元のコミット
const MARKER = ".design-studio-install";
// 写すもの (ルートからの相対)。実行時にスキルが使うものだけを写す。無いもの (gallery など) は飛ばす
const COPY_ENTRIES = [
  "SKILL.md",
  "README.md",
  "CONTEXT.md",
  "package.json",
  "core",
  "scripts",
  "skeletons",
  "app",
  "data",
  "gallery",
  "docs/page-recipe.md",
];

export type InstallResult = { dir: string; files: string[] };

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 置き先。DESIGN_STUDIO_INSTALL_DIR、既定 ~/.claude/skills/design-studio (このスクリプトだけの環境変数) */
export function installDir(env: NodeJS.ProcessEnv): string {
  const value = env.DESIGN_STUDIO_INSTALL_DIR;
  if (typeof value !== "string" || value === "") return join(homedir(), ".claude", "skills", "design-studio");
  return expandHome(value);
}

// ルートからの相対パス。区切りは "/" にそろえる (JSON の files と除外の判定に使う)
function relOf(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

// 写さないもの: テスト、テストの助け、LLM のモック、node_modules
function isExcluded(rel: string): boolean {
  if (rel.endsWith(".test.ts")) return true;
  if (rel === "scripts/test-helper.ts" || rel === "app/mock-llm.mjs") return true;
  return rel.split("/").includes("node_modules");
}

// 1 つのファイルを写し、ルートからの相対を積む
function copyFile(root: string, source: string, target: string, files: string[]): void {
  const rel = relOf(root, source);
  if (isExcluded(rel)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  files.push(rel);
}

// ディレクトリをたどって写す
function copyTree(root: string, source: string, target: string, files: string[]): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const childSource = join(source, entry.name);
    const childTarget = join(target, entry.name);
    if (entry.isDirectory()) {
      if (!isExcluded(relOf(root, childSource))) copyTree(root, childSource, childTarget, files);
    } else if (entry.isFile()) {
      copyFile(root, childSource, childTarget, files);
    }
  }
}

// COPY_ENTRIES のうち、あるものを写す。写したファイルをソートして返す
function copyEntries(dest: string): string[] {
  const files: string[] = [];
  for (const entry of COPY_ENTRIES) {
    const source = join(REPO_ROOT, entry);
    if (!existsSync(source)) continue;
    if (statSync(source).isDirectory()) copyTree(REPO_ROOT, source, join(dest, entry), files);
    else copyFile(REPO_ROOT, source, join(dest, entry), files);
  }
  return files.sort();
}

// 置き先を用意する。目印 (MARKER) のある既存の置き先だけを消して作り直す。無ければ CliExit(2)
function prepareDir(dest: string): void {
  if (resolve(dest) === REPO_ROOT) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: "置き先が開発用リポジトリ自身です", dir: dest });
  }
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    return;
  }
  if (!statSync(dest).isDirectory() || !existsSync(join(dest, MARKER))) {
    throw new CliExit(EXIT_ACTION, {
      error: "marker-missing",
      message: `目印 (${MARKER}) の無い場所には書きません。中身を確かめて、消すか DESIGN_STUDIO_INSTALL_DIR で別の場所を指定してください`,
      dir: dest,
    });
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
}

// 写す元のコミット。git が無い・失敗したときは "unknown"
function commitOf(env: NodeJS.ProcessEnv): string {
  const res = spawnSync(gitCommand(env), ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const sha = (res.stdout ?? "").trim();
  return res.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : "unknown";
}

// 目印を書く。中身は写した日時とコミット
function writeMarker(dest: string, env: NodeJS.ProcessEnv): void {
  const marker = { installedAt: new Date().toISOString(), commit: commitOf(env) };
  writeFileSync(join(dest, MARKER), JSON.stringify(marker, null, 2) + "\n", "utf8");
}

/** 開発用リポジトリの中身を置き先へ写し直し、写したファイルの一覧を返す */
export function installSelf(env: NodeJS.ProcessEnv): InstallResult {
  if (!existsSync(join(REPO_ROOT, "SKILL.md"))) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `SKILL.md がありません: ${REPO_ROOT}` });
  }
  const dest = installDir(env);
  prepareDir(dest);
  const files = copyEntries(dest);
  writeMarker(dest, env);
  return { dir: dest, files };
}

// 例外を標準エラーに書き、終了コードを返す
function reportError(e: unknown): number {
  if (e instanceof CliExit) {
    process.stderr.write(JSON.stringify(e.payload) + "\n");
    return e.code;
  }
  process.stderr.write(JSON.stringify({ error: "internal", message: errorMessage(e) }) + "\n");
  return EXIT_INPUT;
}

function main(argv: string[], env: NodeJS.ProcessEnv): number {
  try {
    if (argv.length > 0) throw usage(`install-self に引数はありません: ${argv.join(" ")}`);
    const result = installSelf(env);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return EXIT_OK;
  } catch (e) {
    return reportError(e);
  }
}

process.exitCode = main(process.argv.slice(2), process.env);
