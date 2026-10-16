// ui-skills.com の索引 (registry.txt) から下書きを作り、追加台帳 (catalog.local.json) へ足す。
// 索引の中身は外部のデータとして扱い、書き込みの前に core/catalog.ts の検証を通す
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadLocalCatalog, localCatalogPath } from "./catalog.ts";
import { CliExit, EXIT_EXTERNAL, EXIT_INPUT } from "./cli-exit.ts";
import { githubBase, gitCommand, registryUrl } from "./paths.ts";
import type { CatalogEntry, CatalogSource } from "./types.ts";

/** 索引 (registry.txt) の 1 行。key は `owner/skill`、rawUrl は SKILL.md の raw URL */
export type RegistryItem = { key: string; rawUrl: string; description: string };

/** add --lookup が返す下書き。利用者が段階と役割を確かめてから書く */
export type Draft = { id: string; name: string; summary: string; source: CatalogSource };

const RAW_PREFIX = "https://raw.githubusercontent.com/";
const SKILL_FILE = "SKILL.md";
const SUMMARY_LIMIT = 500; // 索引の説明を summary に入れる長さの上限
const FETCH_TIMEOUT_MS = 30000;
const GIT_TIMEOUT_MS = 120000;
const COMMIT_RE = /^[0-9a-f]{40}$/;

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// git の子プロセスの環境。対話 (資格情報の確認) で止まらないよう、この 2 つは必ず入れる
function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

// 索引をファイルとして読む。読めないときは外部の失敗 (3)
function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_EXTERNAL, { error: "fetch-failed", url: path, message: `索引を読めませんでした: ${errorMessage(e)}` });
  }
}

// 索引を fetch で取る。HTTP のエラー・時間切れも外部の失敗 (3)
async function fetchText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new CliExit(EXIT_EXTERNAL, { error: "fetch-failed", url, message: `索引を取れませんでした: ${errorMessage(e)}` });
  }
  if (!response.ok) {
    throw new CliExit(EXIT_EXTERNAL, {
      error: "fetch-failed",
      url,
      status: response.status,
      message: `索引を取れませんでした (HTTP ${response.status})`,
    });
  }
  try {
    return await response.text();
  } catch (e) {
    throw new CliExit(EXIT_EXTERNAL, { error: "fetch-failed", url, message: `索引の本文を読めませんでした: ${errorMessage(e)}` });
  }
}

/** 索引を取る。registryUrl(env) が http(s) なら fetch、それ以外はファイルとして読む */
export async function fetchRegistry(env: NodeJS.ProcessEnv): Promise<string> {
  const url = registryUrl(env);
  if (url.startsWith("http://") || url.startsWith("https://")) return fetchText(url);
  return readText(url);
}

/**
 * 索引の本文を行ごとに読む。1 行はタブ区切りで `owner/skill`、SKILL.md の raw URL、説明。
 * 空行と `#` で始まる行は飛ばし、説明が無い行は空文字にする。先頭の BOM は外す
 */
export function parseRegistry(text: string): RegistryItem[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const items: RegistryItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [key = "", rawUrl = "", ...rest] = trimmed.split("\t");
    items.push({ key: key.trim(), rawUrl: rawUrl.trim(), description: rest.join("\t").trim() });
  }
  return items;
}

// raw の URL から repo (owner/name) と path (SKILL.md のあるディレクトリ) を取り出す。
// 想定と違う URL のまま書き込むと危ないため、外部の失敗 (3) にして止める
function parseRawUrl(rawUrl: string, key: string): { repo: string; path: string } {
  const rest = rawUrl.startsWith(RAW_PREFIX) ? rawUrl.slice(RAW_PREFIX.length) : "";
  const parts = rest.split("/");
  const owner = parts[0] ?? "";
  const repo = parts[1] ?? "";
  const dirs = parts.slice(3, -1);
  if (parts.length < 4 || owner === "" || repo === "" || parts[parts.length - 1] !== SKILL_FILE) {
    throw new CliExit(EXIT_EXTERNAL, { error: "fetch-failed", key, rawUrl, message: `索引の URL から取得元を読めませんでした: ${rawUrl}` });
  }
  return { repo: `${owner}/${repo}`, path: dirs.length === 0 ? "." : dirs.join("/") };
}

// git ls-remote <base>/<owner>/<repo>.git HEAD で、既定のブランチの SHA を取る
function headRef(env: NodeJS.ProcessEnv, repo: string, key: string): string {
  const args = ["ls-remote", `${githubBase(env)}/${repo}.git`, "HEAD"];
  const result = spawnSync(gitCommand(env), args, { env: gitEnv(env), encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  const sha = (result.stdout ?? "").trim().split(/\s+/)[0] ?? "";
  if (result.error !== undefined || result.status !== 0 || !COMMIT_RE.test(sha)) {
    throw new CliExit(EXIT_EXTERNAL, { error: "git-failed", key, repo, stderr: `${result.stderr ?? ""}${result.error?.message ?? ""}\n` });
  }
  return sha;
}

// `owner/skill` の skill の部分。id も name もこれを使う
function skillOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

/**
 * 索引の 1 件から下書き (id・name・summary・source) を作る。
 * 索引に無い key は入力の誤り (1)。ref を取れないときは git-failed (3)
 */
export async function draftFromRegistry(key: string, env: NodeJS.ProcessEnv): Promise<Draft> {
  const item = parseRegistry(await fetchRegistry(env)).find((candidate) => candidate.key === key);
  if (item === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `索引に無い key です: ${key}`, key });
  const { repo, path } = parseRawUrl(item.rawUrl, key);
  const skill = skillOf(key);
  return {
    id: skill,
    name: skill,
    summary: item.description.slice(0, SUMMARY_LIMIT),
    source: { type: "github", repo, path, ref: headRef(env, repo, key) },
  };
}

/** 追加台帳 (<home>/catalog.local.json) に足す。同じ id があれば置き換える */
export function addLocalEntry(env: NodeJS.ProcessEnv, entry: CatalogEntry): void {
  const entries = loadLocalCatalog(env);
  const at = entries.findIndex((item) => item.id === entry.id);
  const next = at === -1 ? [...entries, entry] : entries.map((item, index) => (index === at ? entry : item));
  const path = localCatalogPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}
