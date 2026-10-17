// プロジェクト (1 つの依頼から作ったもの) を <home>/projects/<id>/ に保存し、読み戻す。
// 保存の形は版 2 (依頼・回の履歴・点・微調整・画面の種類ごとのページ)。版の無い古い形は読むときに直す。
// 書き込みは同じディレクトリの一時ファイルに書いてから rename する (途中で壊れたファイルを残さない)。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { validateBrief } from "./brief.ts";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { validateFineTune, validatePoints } from "./direction.ts";
import { readJsonFile } from "./json-file.ts";
import { pageKeyOf, validatePageType } from "./page-type.ts";
import { studioHome } from "./paths.ts";
import { validateDirection } from "./styles.ts";
import { PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "./types.ts";
import type { Direction, MixPoint, MixPoints, PageEntry, PageType, Project, Round, SkeletonFamily } from "./types.ts";

const PROJECT_FILE = "project.json";
const THEME_FILE = "theme.css";
const PAGES_DIR = "pages";
// プロジェクトの id とページの保存のキーは同じ形 (contract.md の 2・7 節)
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// 1 つの回の原案の数 (contract.md の 7 節: drafts は 1〜4 件)
const DRAFTS_MIN = 1;
const DRAFTS_MAX = 4;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isNotFound = (e: unknown): boolean => isRecord(e) && e.code === "ENOENT";

/** 入力の id を検証する。合わなければ CliExit(1) */
export function validateProjectId(id: unknown): string {
  if (typeof id !== "string" || !SLUG_RE.test(id)) {
    throw inputError("id は /^[a-z0-9][a-z0-9-]{0,39}$/ に合う 40 文字以内の文字列で指定してください");
  }
  return id;
}

// ページの保存のキー。読み込みは外から受けるので確かめる
function keyOf(value: unknown, label: string): string {
  if (typeof value !== "string" || !SLUG_RE.test(value)) {
    throw inputError(`${label} は /^[a-z0-9][a-z0-9-]{0,39}$/ に合う 40 文字以内の文字列で指定してください`);
  }
  return value;
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

// 空でない文字列
function timeOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw inputError(`${label} は文字列で指定してください`);
  return value;
}

// ===== 検証 (版 2 の形。contract.md の 7 節) =====

// 保存に要る項目。時刻は保存するときに決める
type ProjectContent = Omit<Project, "createdAt" | "updatedAt">;

// 入力のプロジェクトを検証する。版が無ければ古い形として直し、2 以外の数なら入力の誤り
function validateProjectContent(x: unknown): ProjectContent {
  const raw = recordOf(x, "project");
  return raw.version === undefined ? upgradedContent(raw) : newContentOf(raw);
}

function newContentOf(raw: Record<string, unknown>): ProjectContent {
  if (raw.version !== 2) throw inputError("project.version は 2 で指定してください");
  const rounds = validateRounds(raw.rounds);
  return {
    version: 2,
    id: validateProjectId(raw.id),
    brief: validateBrief(raw.brief),
    pageType: pageTypeWithFamily(raw.pageType),
    rounds,
    roundIndex: validateRoundIndex(raw.roundIndex, rounds.length),
    points: validatePoints(raw.points),
    fineTune: validateFineTune(raw.fineTune),
    pages: validatePageEntries(raw.pages),
  };
}

// 画面の種類。保存の形では family が要る (validatePageType は任意なので足りない分を止める)
function pageTypeWithFamily(value: unknown): PageType {
  const parsed = validatePageType(value);
  if (parsed.family === undefined) {
    throw inputError(`pageType.family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
  }
  return { name: parsed.name, family: parsed.family };
}

// 回の履歴。1 件以上で、各回の原案は 1〜4 件、編集は原案と同じ長さ
function validateRounds(value: unknown): Round[] {
  if (!Array.isArray(value) || value.length < 1) throw inputError("rounds は 1 件以上の配列で指定してください");
  return value.map((entry, index) => validateRound(entry, index));
}

function validateRound(value: unknown, index: number): Round {
  const raw = recordOf(value, `rounds[${index}]`);
  const drafts = draftsOf(raw.drafts, index);
  return { drafts, edits: editsOf(raw.edits, drafts.length, index) };
}

function draftsOf(value: unknown, index: number): Direction[] {
  if (!Array.isArray(value) || value.length < DRAFTS_MIN || value.length > DRAFTS_MAX) {
    throw inputError(`rounds[${index}].drafts は ${DRAFTS_MIN}〜${DRAFTS_MAX} 件の配列で指定してください`);
  }
  return value.map((draft) => validateDirection(draft));
}

// 編集は原案と同じ長さ。null は「原案のまま」を表す
function editsOf(value: unknown, count: number, index: number): (Direction | null)[] {
  if (!Array.isArray(value) || value.length !== count) {
    throw inputError(`rounds[${index}].edits は drafts と同じ ${String(count)} 件の配列で指定してください`);
  }
  return value.map((edit) => (edit === null ? null : validateDirection(edit)));
}

// 今の回の添字。rounds の中の整数
function validateRoundIndex(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= count) {
    throw inputError(`roundIndex は 0〜${String(count - 1)} の整数で指定してください`);
  }
  return value;
}

// 保存したページの一覧
function validatePageEntries(value: unknown): PageEntry[] {
  if (!Array.isArray(value)) throw inputError("pages は配列で指定してください");
  return value.map((entry, index) => validatePageEntry(entry, index));
}

function validatePageEntry(value: unknown, index: number): PageEntry {
  const raw = recordOf(value, `pages[${index}]`);
  const parsed = validatePageType(raw);
  if (parsed.family === undefined) {
    throw inputError(`pages[${index}].family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
  }
  return { key: keyOf(raw.key, `pages[${index}].key`), name: parsed.name, family: parsed.family };
}

// ===== 古い形 (版が無い) を版 2 に直す =====

function upgradedContent(raw: Record<string, unknown>): ProjectContent {
  const family = oneOf(raw.pageType, SKELETON_FAMILIES, "pageType");
  return {
    version: 2,
    id: validateProjectId(raw.id),
    brief: validateBrief({ what: raw.prompt }),
    pageType: candidateOfFamily(family),
    rounds: [{ drafts: [validateDirection(raw.direction)], edits: [null] }],
    roundIndex: 0,
    points: pointsA(),
    fineTune: {},
    pages: oldPagesOf(raw.pages),
  };
}

// 候補の中の同じ骨組みの種類の画面の種類
function candidateOfFamily(family: SkeletonFamily): PageType {
  return PAGE_TYPE_CANDIDATES.find((candidate) => candidate.family === family) ?? { name: family, family };
}

// 古い形の pages は骨組みの種類の並び。保存のキーと候補の名前を補う
function oldPagesOf(value: unknown): PageEntry[] {
  if (!Array.isArray(value)) throw inputError("pages は配列で指定してください");
  return value.map((item, index) => {
    const family = oneOf(item, SKELETON_FAMILIES, `pages[${index}]`);
    const candidate = candidateOfFamily(family);
    return { key: family, name: candidate.name, family };
  });
}

// パッドの点は 4 軸とも A の隅 (0, 0)
function pointsA(): MixPoints {
  const point = (): MixPoint => ({ x: 0, y: 0 });
  return { color: point(), font: point(), shape: point(), layout: point() };
}

// ===== 保存と読み込み =====

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

// 既存の pages に今回のページを足す。同じ key があれば name と family を新しくする (足した順)
function mergePageEntries(existing: PageEntry[], pageType: PageType | undefined): PageEntry[] {
  const merged = [...existing];
  if (pageType === undefined) return merged;
  const entry: PageEntry = { key: pageKeyOf(pageType), name: pageType.name, family: pageType.family };
  const index = merged.findIndex((page) => page.key === entry.key);
  if (index < 0) merged.push(entry);
  else merged[index] = entry;
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
  const content = validateProjectContent(input.project);
  const pageType = input.page === undefined ? undefined : pageTypeWithFamily(input.page.pageType);
  const dir = projectDir(env, content.id);
  const existing = readExistingForSave(env, content.id);
  const now = new Date().toISOString();
  const project: Project = {
    ...content,
    pages: mergePageEntries(existing?.project.pages ?? [], pageType),
    createdAt: existing?.project.createdAt ?? now,
    updatedAt: now,
  };
  mkdirSync(dir, { recursive: true });
  // 中身のファイルを先に書き、project.json を最後に書く (保存が終わった印にする)
  if (input.themeCss !== undefined) writeFileAt(join(dir, THEME_FILE), input.themeCss, "theme.css");
  if (input.page !== undefined && pageType !== undefined) {
    const key = pageKeyOf(pageType);
    const pagesDir = join(dir, PAGES_DIR);
    mkdirSync(pagesDir, { recursive: true });
    writeFileAt(join(pagesDir, `${key}.html`), input.page.html, `${key}.html`);
  }
  writeFileAt(join(dir, PROJECT_FILE), JSON.stringify(project, null, 2) + "\n", "project");
  return project;
}

// 保存済みの project.json。時刻も文字列で必須
function validateProject(x: unknown): Project {
  const raw = recordOf(x, "project");
  return {
    ...validateProjectContent(raw),
    createdAt: timeOf(raw.createdAt, "createdAt"),
    updatedAt: timeOf(raw.updatedAt, "updatedAt"),
  };
}

/** プロジェクトを読む。project.json が無ければ null。古い形 (版が無い) は新しい形に直して返す */
export function readProject(env: NodeJS.ProcessEnv, id: string): { project: Project; dir: string } | null {
  const dir = projectDir(env, id);
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) return null;
  return { project: validateProject(readJsonFile(file, "project")), dir };
}

/** ページの html を読む。無ければ null。key は pageKeyOf が作る形の文字列 */
export function readPage(env: NodeJS.ProcessEnv, id: string, key: string): string | null {
  const pageKey = keyOf(key, "key");
  const file = join(projectDir(env, id), PAGES_DIR, `${pageKey}.html`);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw new CliExit(EXIT_INPUT, { error: "file", file: `${pageKey}.html`, path: file, message: errorMessage(e) });
  }
}

export type ProjectSummary = {
  id: string;
  what: string;
  pageType: PageType;
  name: string;
  pages: PageEntry[];
  updatedAt: string;
};

// 今の回の先頭の案 (編集があれば編集後)
function currentDirectionOf(project: Project): Direction {
  const round = project.rounds[project.roundIndex];
  const direction = round?.edits[0] ?? round?.drafts[0];
  if (direction === undefined) throw inputError("project.rounds に案がありません");
  return direction;
}

// 読めた 1 件を一覧の形にする
function summaryOf(found: { project: Project; dir: string }): ProjectSummary {
  const { project } = found;
  return {
    id: project.id,
    what: project.brief.what,
    pageType: project.pageType,
    name: currentDirectionOf(project).name,
    pages: project.pages,
    updatedAt: project.updatedAt,
  };
}

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
  return entries.filter((entry) => entry.isDirectory() && SLUG_RE.test(entry.name)).map((entry) => entry.name);
}

export type BrokenProject = { id: string; message: string };
export type ProjectsListing = { projects: ProjectSummary[]; broken: BrokenProject[] };

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
