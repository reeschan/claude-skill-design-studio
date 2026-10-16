// プロジェクト (1 つの依頼から作ったもの) を <home>/projects/<id>/ に保存し、読み戻す。
// 書き込みは同じディレクトリの一時ファイルに書いてから rename する (途中で壊れたファイルを残さない)。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import { studioHome } from "./paths.ts";
import { validateDirection } from "./styles.ts";
import { PAGE_TYPES } from "./types.ts";
import type { Direction, PageType, Project } from "./types.ts";

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PROMPT_MAX = 2000;
const PROJECT_FILE = "project.json";
const THEME_FILE = "theme.css";
const PAGES_DIR = "pages";

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isNotFound = (e: unknown): boolean => isRecord(e) && e.code === "ENOENT";

/** 入力の id を検証する。合わなければ CliExit(1) */
export function validateProjectId(id: unknown): string {
  if (typeof id !== "string" || !PROJECT_ID_RE.test(id)) {
    throw inputError("id は /^[a-z0-9][a-z0-9-]{0,39}$/ に合う 40 文字以内の文字列で指定してください");
  }
  return id;
}

// 列挙のいずれか
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

// オブジェクト
function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw inputError(`${label} はオブジェクトで指定してください`);
  return value;
}

// 1〜2000 文字の依頼文。前後の空白は落とす (style-guide の validatePrompt と同じ)
function validatePrompt(value: unknown): string {
  if (typeof value !== "string") throw inputError("prompt は文字列で指定してください");
  const prompt = value.trim();
  if (prompt.length < 1 || prompt.length > PROMPT_MAX) throw inputError(`prompt は trim 後 1〜${PROMPT_MAX} 文字で指定してください`);
  return prompt;
}

function validatePages(value: unknown): PageType[] {
  if (!Array.isArray(value)) throw inputError("pages は配列で指定してください");
  return value.map((item, index) => oneOf(item, PAGE_TYPES, `pages[${index}]`));
}

// 空でない文字列
function timeOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw inputError(`${label} は文字列で指定してください`);
  return value;
}

// 保存に要る項目。時刻は保存するときに決める
type ProjectFields = { id: string; prompt: string; pageType: PageType; direction: Direction; pages: PageType[] };

function validateProjectFields(x: Record<string, unknown>): ProjectFields {
  return {
    id: validateProjectId(x.id),
    prompt: validatePrompt(x.prompt),
    pageType: oneOf(x.pageType, PAGE_TYPES, "pageType"),
    direction: validateDirection(x.direction),
    pages: validatePages(x.pages),
  };
}

// 保存済みの project.json。時刻も文字列で必須
function validateProject(x: unknown): Project {
  const raw = recordOf(x, "project");
  const fields = validateProjectFields(raw);
  return { ...fields, createdAt: timeOf(raw.createdAt, "createdAt"), updatedAt: timeOf(raw.updatedAt, "updatedAt") };
}

// プロジェクトの置き場 <home>/projects
function projectsDir(env: NodeJS.ProcessEnv): string {
  return join(studioHome(env), "projects");
}

/** プロジェクトのディレクトリ。id を検証してから組み立てる */
export function projectDir(env: NodeJS.ProcessEnv, id: string): string {
  return join(projectsDir(env), validateProjectId(id));
}

/** 同じディレクトリの一時ファイルに書いてから rename する */
function writeFileAt(path: string, content: string, label: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 一時ファイルを消せなくても、元の失敗を伝える
    }
    throw new CliExit(EXIT_INPUT, { error: "file", file: label, path, message: errorMessage(e) });
  }
}

// 既存の pages と今回のページの種類だけを合わせ、重複を除く (足した順。入力の pages は積まない)
function mergePages(existing: PageType[], added: PageType | undefined): PageType[] {
  const merged = [...existing];
  if (added !== undefined && !merged.includes(added)) merged.push(added);
  return merged;
}

export type SaveProjectInput = {
  project: unknown; // 検証してから保存する (CLI はファイルから読んだ JSON を渡す)
  themeCss?: string;
  page?: { pageType: PageType; html: string };
};

// 壊れた project.json を同じディレクトリに退避する (消さない)
function quarantineProject(env: NodeJS.ProcessEnv, id: string): void {
  const dir = projectDir(env, id);
  const file = join(dir, PROJECT_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `${PROJECT_FILE}.broken-${stamp}`);
  try {
    renameSync(file, target);
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: PROJECT_FILE, path: file, message: errorMessage(e) });
  }
}

// 既存を読む。読めない・検証で落ちるときは退避して初回の保存として扱う
function readExistingForSave(env: NodeJS.ProcessEnv, id: string): { project: Project; dir: string } | null {
  try {
    return readProject(env, id);
  } catch (e) {
    if (!(e instanceof CliExit)) throw e;
    quarantineProject(env, id);
    return null;
  }
}

/** プロジェクトを保存する。createdAt は初回だけ、updatedAt は毎回今の時刻にする */
export function saveProject(env: NodeJS.ProcessEnv, input: SaveProjectInput): Project {
  const fields = validateProjectFields(recordOf(input.project, "project"));
  const dir = projectDir(env, fields.id);
  const existing = readExistingForSave(env, fields.id);
  const pageType = input.page === undefined ? undefined : oneOf(input.page.pageType, PAGE_TYPES, "page.pageType");
  const now = new Date().toISOString();
  const project: Project = {
    id: fields.id,
    prompt: fields.prompt,
    pageType: fields.pageType,
    direction: fields.direction,
    pages: mergePages(existing?.project.pages ?? [], pageType),
    createdAt: existing?.project.createdAt ?? now,
    updatedAt: now,
  };
  mkdirSync(dir, { recursive: true });
  // 中身のファイルを先に書き、project.json を最後に書く (保存が終わった印にする)
  if (input.themeCss !== undefined) writeFileAt(join(dir, THEME_FILE), input.themeCss, "theme.css");
  if (input.page !== undefined && pageType !== undefined) {
    const html = input.page.html;
    const pagesDir = join(dir, PAGES_DIR);
    mkdirSync(pagesDir, { recursive: true });
    writeFileAt(join(pagesDir, `${pageType}.html`), html, `${pageType}.html`);
  }
  writeFileAt(join(dir, PROJECT_FILE), JSON.stringify(project, null, 2) + "\n", "project");
  return project;
}

/** プロジェクトを読む。project.json が無ければ null */
export function readProject(env: NodeJS.ProcessEnv, id: string): { project: Project; dir: string } | null {
  const dir = projectDir(env, id);
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) return null;
  return { project: validateProject(readJsonFile(file, "project")), dir };
}

/** ページの html を読む。無ければ null */
export function readPage(env: NodeJS.ProcessEnv, id: string, pageType: PageType): string | null {
  const page = oneOf(pageType, PAGE_TYPES, "pageType");
  const file = join(projectDir(env, id), PAGES_DIR, `${page}.html`);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw new CliExit(EXIT_INPUT, { error: "file", file: `${page}.html`, path: file, message: errorMessage(e) });
  }
}

export type ProjectSummary = { id: string; prompt: string; pageType: PageType; name: string; pages: PageType[]; updatedAt: string };

// projects の下の、id の形をしたディレクトリの名前
function projectIds(env: NodeJS.ProcessEnv): string[] {
  const root = projectsDir(env);
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (e) {
    if (isNotFound(e)) return [];
    throw new CliExit(EXIT_INPUT, { error: "file", path: root, message: errorMessage(e) });
  }
  return entries.filter((entry) => entry.isDirectory() && PROJECT_ID_RE.test(entry.name)).map((entry) => entry.name);
}

export type BrokenProject = { id: string; message: string };
export type ProjectsListing = { projects: ProjectSummary[]; broken: BrokenProject[] };

// 読めた 1 件を一覧の形にする
function summaryOf(found: { project: Project; dir: string }): ProjectSummary {
  const { project } = found;
  return {
    id: project.id,
    prompt: project.prompt,
    pageType: project.pageType,
    name: project.direction.name,
    pages: project.pages,
    updatedAt: project.updatedAt,
  };
}

/** プロジェクトの一覧を updatedAt の新しい順に返す。読めない・検証で落ちる項目は broken に入れる */
export function listProjectsWithBroken(env: NodeJS.ProcessEnv): ProjectsListing {
  const projects: ProjectSummary[] = [];
  const broken: BrokenProject[] = [];
  for (const id of projectIds(env)) {
    try {
      const found = readProject(env, id);
      if (found !== null) projects.push(summaryOf(found));
    } catch (e) {
      if (!(e instanceof CliExit)) throw e;
      broken.push({ id, message: e.message });
    }
  }
  projects.sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
  return { projects, broken };
}

/** プロジェクトの一覧を updatedAt の新しい順に返す */
export function listProjects(env: NodeJS.ProcessEnv): ProjectSummary[] {
  return listProjectsWithBroken(env).projects;
}
