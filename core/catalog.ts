// 台帳 (同梱 12 件 + 利用者の追加) の読み込み・検証と、導入状態・使う/使わないを重ねた一覧
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import { pluginsDir, skillsDir, studioHome } from "./paths.ts";
import { STAGES } from "./types.ts";
import type { CatalogEntry, CatalogSource, CatalogView, Stage } from "./types.ts";

// core/catalog.ts の 1 つ上 = リポジトリのルート。カレントディレクトリに依存しない
const BUNDLED_PATH = fileURLToPath(new URL("../data/catalog.json", import.meta.url));

const SKILL_FILE = "SKILL.md";
const CONFIG_FILE = "config.json";
const LOCAL_FILE = "catalog.local.json";
const PLUGIN_DEPTH_LIMIT = 8;

// スキル名はディレクトリ名になるため、先頭が数字でもよい (12-principles-of-animation)
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// repo は owner/name、path はリポジトリ内の相対パス。`.` や `..`・絶対パス・ドライブ文字でリポジトリの外を指せないようにする
const REPO_PART_RE = /^[A-Za-z0-9._-]+$/;
const DRIVE_RE = /^[A-Za-z]:/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

/** <home>/config.json の中身。書かれていない id は使う (true) */
export type CatalogConfig = { enabled: Record<string, boolean> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => typeof item === "string");
const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

// 検証の失敗は終了コード 1 の入力エラーにする
function invalid(message: string): CliExit {
  return new CliExit(EXIT_INPUT, { error: "input", message });
}

function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (!isRecord(v)) throw invalid(`${where} はオブジェクトで指定してください`);
  return v;
}

function asString(v: unknown, where: string): string {
  if (typeof v !== "string" || v === "") throw invalid(`${where} は空でない文字列で指定してください`);
  return v;
}

// 説明の文 (summary・exampleRequest・exampleOutput) は空でもよいので、文字列であることだけを確かめる
function asText(v: unknown, where: string): string {
  if (typeof v !== "string") throw invalid(`${where} は文字列で指定してください`);
  return v;
}

function asBoolean(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") throw invalid(`${where} は真偽値で指定してください`);
  return v;
}

function asStringArray(v: unknown, where: string): string[] {
  if (!isStringArray(v)) throw invalid(`${where} は文字列の配列で指定してください`);
  return v;
}

// owner/name の各部分として使えるか。`.` と `..` はリポジトリの外を指せるため拒む
function isRepoPart(part: string): boolean {
  return REPO_PART_RE.test(part) && part !== "." && part !== "..";
}

// `/` でちょうど 2 つに分かれ、各部分が owner/name の一部として使えるか
function isRepo(repo: string): boolean {
  const parts = repo.split("/");
  return parts.length === 2 && parts.every(isRepoPart);
}

// リポジトリ内の相対パスか。絶対パス・ドライブ文字・`\`・空の区間・`.` / `..` の区間を拒む (`.` だけは許す)
function isRepoPath(path: string): boolean {
  if (path === ".") return true;
  if (DRIVE_RE.test(path) || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validateSource(v: unknown, where: string): CatalogSource {
  const source = asRecord(v, where);
  if (source.type === "github") {
    const repo = asString(source.repo, `${where}.repo`);
    if (!isRepo(repo)) throw invalid(`${where}.repo は "owner/name" の形で指定してください`);
    const path = asString(source.path, `${where}.path`);
    if (!isRepoPath(path)) throw invalid(`${where}.path はリポジトリ内の相対パスで指定してください`);
    const ref = asString(source.ref, `${where}.ref`);
    if (!COMMIT_RE.test(ref)) throw invalid(`${where}.ref は 40 桁のコミット SHA で指定してください`);
    return { type: "github", repo, path, ref };
  }
  if (source.type === "plugin") {
    return {
      type: "plugin",
      plugin: asString(source.plugin, `${where}.plugin`),
      marketplace: asString(source.marketplace, `${where}.marketplace`),
    };
  }
  throw invalid(`${where}.type は "github" か "plugin" で指定してください`);
}

function validatePrerequisites(v: unknown, where: string): { label: string; command: string }[] {
  if (!isUnknownArray(v)) throw invalid(`${where} は配列で指定してください`);
  return v.map((item, i) => {
    const at = `${where}[${i}]`;
    const prerequisite = asRecord(item, at);
    return { label: asString(prerequisite.label, `${at}.label`), command: asString(prerequisite.command, `${at}.command`) };
  });
}

/** 台帳の 1 件を検証して返す。不正なら CliExit(1, {error:"input"}) */
export function validateCatalogEntry(x: unknown, label = "台帳"): CatalogEntry {
  const entry = asRecord(x, label);
  const id = asString(entry.id, `${label}.id`);
  if (!ID_RE.test(id)) throw invalid(`${label}.id は英小文字・数字・ハイフンだけで指定してください: ${id}`);
  const stage = entry.stage;
  if (!isStage(stage)) throw invalid(`${label}.stage は ${STAGES.join(" / ")} のどれかで指定してください`);
  const target = entry.target;
  if (target !== "any" && target !== "react") throw invalid(`${label}.target は "any" か "react" で指定してください`);
  return {
    id,
    name: asString(entry.name, `${label}.name`),
    stage,
    role: asString(entry.role, `${label}.role`),
    roleLabel: asString(entry.roleLabel, `${label}.roleLabel`),
    isDefault: asBoolean(entry.isDefault, `${label}.isDefault`),
    source: validateSource(entry.source, `${label}.source`),
    prerequisites: validatePrerequisites(entry.prerequisites, `${label}.prerequisites`),
    target,
    license: asString(entry.license, `${label}.license`),
    summary: asText(entry.summary, `${label}.summary`),
    exampleRequest: asText(entry.exampleRequest, `${label}.exampleRequest`),
    exampleOutput: asText(entry.exampleOutput, `${label}.exampleOutput`),
    notes: asStringArray(entry.notes, `${label}.notes`),
    invokeFlags: asStringArray(entry.invokeFlags, `${label}.invokeFlags`),
  };
}

function validateCatalogList(x: unknown, label: string): CatalogEntry[] {
  if (!isUnknownArray(x)) throw invalid(`${label} は配列で指定してください`);
  return x.map((entry, i) => validateCatalogEntry(entry, `${label}[${i}]`));
}

/** 同梱の data/catalog.json を読む (モジュールの場所から解決する) */
export function loadBundledCatalog(): CatalogEntry[] {
  return validateCatalogList(readJsonFile(BUNDLED_PATH, "data/catalog.json"), "data/catalog.json");
}

/** 追加台帳の場所。PBI-010 (アプリ) も使う */
export function localCatalogPath(env: NodeJS.ProcessEnv): string {
  return join(studioHome(env), LOCAL_FILE);
}

/** <home>/catalog.local.json を読む。無ければ空 */
export function loadLocalCatalog(env: NodeJS.ProcessEnv): CatalogEntry[] {
  const path = localCatalogPath(env);
  if (!existsSync(path)) return [];
  return validateCatalogList(readJsonFile(path, LOCAL_FILE), LOCAL_FILE);
}

// 読めないディレクトリ (無い・権限が無い) は空として扱う
function readChildren(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// <dir> の下 (深さ 8 まで) の skills/<id>/SKILL.md を探す。marketplaces には入らず、シンボリックリンクもたどらない
function findPluginSkill(dir: string, id: string, depth: number): boolean {
  if (depth > PLUGIN_DEPTH_LIMIT) return false;
  for (const child of readChildren(dir)) {
    if (!child.isDirectory() || child.name === "marketplaces") continue;
    const path = join(dir, child.name);
    if (child.name === "skills" && existsSync(join(path, id, SKILL_FILE))) return true;
    if (findPluginSkill(path, id, depth + 1)) return true;
  }
  return false;
}

/** 導入済みか。github は <skillsDir>/<id>/SKILL.md、plugin は <pluginsDir> の下の skills/<id>/SKILL.md */
export function isInstalled(entry: CatalogEntry, env: NodeJS.ProcessEnv): boolean {
  if (entry.source.type === "github") return existsSync(join(skillsDir(env), entry.id, SKILL_FILE));
  return findPluginSkill(pluginsDir(env), entry.id, 1);
}

function configPath(env: NodeJS.ProcessEnv): string {
  return join(studioHome(env), CONFIG_FILE);
}

/** <home>/config.json を読む。無ければ空 (すべて既定 = 使う) */
export function readConfig(env: NodeJS.ProcessEnv): CatalogConfig {
  const path = configPath(env);
  if (!existsSync(path)) return { enabled: {} };
  const raw = readJsonFile(path, CONFIG_FILE);
  if (!isRecord(raw)) throw invalid(`${CONFIG_FILE} はオブジェクトで指定してください: ${path}`);
  if (raw.enabled === undefined) return { enabled: {} };
  if (!isRecord(raw.enabled)) throw invalid(`${CONFIG_FILE} の enabled はオブジェクトで指定してください: ${path}`);
  const enabled: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(raw.enabled)) enabled[id] = asBoolean(value, `${CONFIG_FILE} の enabled.${id}`);
  return { enabled };
}

/** 使う/使わないを保存する。ほかの項目は残す */
export function setEnabled(env: NodeJS.ProcessEnv, id: string, enabled: boolean): void {
  const config = readConfig(env);
  config.enabled[id] = enabled;
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ enabled: config.enabled }, null, 2) + "\n", "utf8");
}

/** 同梱 + 追加 (同じ id は追加側が勝つ) に、導入状態・使う/使わない・出どころを重ねて返す */
export function listCatalog(env: NodeJS.ProcessEnv): CatalogView[] {
  const localById = new Map(loadLocalCatalog(env).map((entry): [string, CatalogEntry] => [entry.id, entry]));
  const bundled = loadBundledCatalog().map((entry) => localById.get(entry.id) ?? entry);
  const bundledIds = new Set(bundled.map((entry) => entry.id));
  const extras = [...localById.values()].filter((entry) => !bundledIds.has(entry.id));
  const config = readConfig(env);
  return [...bundled, ...extras].map((entry) => ({
    ...entry,
    installed: isInstalled(entry, env),
    enabled: config.enabled[entry.id] ?? true,
    origin: localById.has(entry.id) ? "local" : "bundled",
  }));
}
