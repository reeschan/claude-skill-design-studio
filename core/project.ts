// プロジェクト (1 つの依頼から作ったもの) を <home>/projects/<id>/ に保存し、読み戻す。
// 保存の形は版 3 (依頼・回の履歴・点・微調整・表現・保存した 1 件ごとの item)。版 2 と版の無い古い形は読むときに直す。
// 書き込みは同じディレクトリの一時ファイルに書いてから rename する (途中で壊れたファイルを残さない)。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { validateBrief } from "./brief.ts";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import {
  COMPONENT_SHEET_KEY,
  COMPONENT_SHEET_NAME,
  componentItemIdentity,
  componentKeyOf,
  validateComponentName,
  validateComponentTarget,
} from "./component.ts";
import { validateFineTune, validatePoints } from "./direction.ts";
import {
  DESIGN_GUIDE_DIR,
  DESIGN_GUIDE_FILE_NAMES,
  DESIGN_GUIDE_KEY,
  DESIGN_GUIDE_NAME,
  validateDesignGuideFiles,
  writeDesignGuideFolder,
} from "./design-guide.ts";
import type { DesignGuideFile } from "./design-guide.ts";
import { readJsonFile } from "./json-file.ts";
import { pageKeyOf, validatePageType } from "./page-type.ts";
import { studioHome } from "./paths.ts";
import { validateDirection } from "./styles.ts";
import { DEFAULT_TREATMENT, validateTreatment } from "./treatment.ts";
import { PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "./types.ts";
import type { Direction, MixPoint, MixPoints, PageType, Project, Round, SavedItem, SkeletonFamily, Treatment } from "./types.ts";
import type { ComponentItem, ComponentSheetItem, ComponentTarget, DesignGuideItem, PageItem } from "./types.ts";

const PROJECT_FILE = "project.json";
const THEME_FILE = "theme.css";
const PAGES_DIR = "pages";
const COMPONENTS_DIR = "components";
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

// ===== 検証 (版 3 の形。contract.md の 7 節) =====

// 保存に要る項目。時刻は保存するときに決める
type ProjectContent = Omit<Project, "createdAt" | "updatedAt">;
// 版 2・3 で同じ項目 (版・表現・items 以外)
type SharedContent = Omit<ProjectContent, "version" | "treatment" | "items">;
// ページの項目 (items の kind と treatment 以外)
type PageFields = Omit<PageItem, "kind" | "treatment">;

// 入力のプロジェクトを検証する。版が無ければ古い形として直し、2 は版 3 に直し、3 以外の数なら入力の誤り
function validateProjectContent(x: unknown): ProjectContent {
  const raw = recordOf(x, "project");
  if (raw.version === 3) {
    return {
      ...sharedContentOf(raw),
      version: 3,
      treatment: validateTreatment(raw.treatment),
      items: validateSavedItems(raw.items),
    };
  }
  if (raw.version === 2) return version3From(sharedContentOf(raw), validatePageEntries(raw.pages));
  if (raw.version === undefined) return upgradedContent(raw);
  throw inputError("project.version は 3 で指定してください");
}

// 版 2・3 で同じ項目を検証する
function sharedContentOf(raw: Record<string, unknown>): SharedContent {
  const rounds = validateRounds(raw.rounds);
  return {
    id: validateProjectId(raw.id),
    brief: validateBrief(raw.brief),
    pageType: pageTypeWithFamily(raw.pageType),
    rounds,
    roundIndex: validateRoundIndex(raw.roundIndex, rounds.length),
    points: validatePoints(raw.points),
    fineTune: validateFineTune(raw.fineTune),
  };
}

// 既定の表現の写し (item ごとに別のオブジェクトにする)
function defaultTreatmentCopy(): Treatment {
  return { ...DEFAULT_TREATMENT, motionSamples: [] };
}

// 直したページに、作ったときの表現 (既定) を足して版 3 にする
function version3From(shared: SharedContent, pages: PageFields[]): ProjectContent {
  return {
    ...shared,
    version: 3,
    treatment: defaultTreatmentCopy(),
    items: pages.map((page): SavedItem => ({ kind: "page", ...page, treatment: defaultTreatmentCopy() })),
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

// 保存した 1 件の一覧。kind は page / component-sheet / component / design-guide
function validateSavedItems(value: unknown): SavedItem[] {
  if (!Array.isArray(value)) throw inputError("items は配列で指定してください");
  return value.map((entry, index) => validateSavedItem(entry, index));
}

function validateSavedItem(value: unknown, index: number): SavedItem {
  const raw = recordOf(value, `items[${index}]`);
  const label = `items[${index}]`;
  if (raw.kind === "page") return savedPageOf(raw, label);
  if (raw.kind === "component-sheet") return savedComponentSheetOf(raw, label);
  if (raw.kind === "component") return savedComponentOf(raw, label);
  if (raw.kind === "design-guide") return savedDesignGuideOf(raw, label);
  throw inputError(`${label}.kind は page / component-sheet / component / design-guide のいずれかで指定してください`);
}

// ページの item。保存のキーと family は今までどおり
function savedPageOf(raw: Record<string, unknown>, label: string): PageItem {
  return { kind: "page", ...pageFieldsOf(raw, label), treatment: validateTreatment(raw.treatment) };
}

// 部品帳の item。key と name は固定の値だけ
function savedComponentSheetOf(raw: Record<string, unknown>, label: string): ComponentSheetItem {
  if (raw.key !== COMPONENT_SHEET_KEY) throw inputError(`${label}.key は ${COMPONENT_SHEET_KEY} で指定してください`);
  if (raw.name !== COMPONENT_SHEET_NAME) throw inputError(`${label}.name は ${COMPONENT_SHEET_NAME} で指定してください`);
  return { kind: "component-sheet", key: COMPONENT_SHEET_KEY, name: COMPONENT_SHEET_NAME, treatment: validateTreatment(raw.treatment) };
}

// 部品の item。名前を検証し、key は名前から作った値と一致させる
function savedComponentOf(raw: Record<string, unknown>, label: string): ComponentItem {
  const name = validateComponentName(raw.name);
  const key = componentKeyOf(name);
  if (raw.key !== key) throw inputError(`${label}.key は ${key} で指定してください`);
  return { kind: "component", key, name, treatment: validateTreatment(raw.treatment) };
}

// デザインガイドの item。key と name は固定の値だけ
function savedDesignGuideOf(raw: Record<string, unknown>, label: string): DesignGuideItem {
  if (raw.key !== DESIGN_GUIDE_KEY) throw inputError(`${label}.key は ${DESIGN_GUIDE_KEY} で指定してください`);
  if (raw.name !== DESIGN_GUIDE_NAME) throw inputError(`${label}.name は ${DESIGN_GUIDE_NAME} で指定してください`);
  return { kind: "design-guide", key: DESIGN_GUIDE_KEY, name: DESIGN_GUIDE_NAME, treatment: validateTreatment(raw.treatment) };
}

// 版 2 のページの一覧 (items に直す前の形)
function validatePageEntries(value: unknown): PageFields[] {
  if (!Array.isArray(value)) throw inputError("pages は配列で指定してください");
  return value.map((entry, index) => pageFieldsOf(recordOf(entry, `pages[${index}]`), `pages[${index}]`));
}

// ページの項目。name・family は validatePageType、key は保存のキーの形で確かめる
function pageFieldsOf(raw: Record<string, unknown>, label: string): PageFields {
  const parsed = validatePageType(raw);
  if (parsed.family === undefined) {
    throw inputError(`${label}.family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
  }
  return { key: keyOf(raw.key, `${label}.key`), name: parsed.name, family: parsed.family };
}

// ===== 古い形 (版が無い) を版 3 に直す =====

function upgradedContent(raw: Record<string, unknown>): ProjectContent {
  const family = oneOf(raw.pageType, SKELETON_FAMILIES, "pageType");
  return {
    version: 3,
    id: validateProjectId(raw.id),
    brief: validateBrief({ what: raw.prompt }),
    pageType: candidateOfFamily(family),
    treatment: defaultTreatmentCopy(),
    rounds: [{ drafts: [validateDirection(raw.direction)], edits: [null] }],
    roundIndex: 0,
    points: pointsA(),
    fineTune: {},
    items: oldPagesOf(raw.pages),
  };
}

// 候補の中の同じ骨組みの種類の画面の種類
function candidateOfFamily(family: SkeletonFamily): PageType {
  return PAGE_TYPE_CANDIDATES.find((candidate) => candidate.family === family) ?? { name: family, family };
}

// 古い形の pages は骨組みの種類の並び。保存のキーと候補の名前、既定の表現を補う
function oldPagesOf(value: unknown): SavedItem[] {
  if (!Array.isArray(value)) throw inputError("pages は配列で指定してください");
  return value.map((item, index) => {
    const family = oneOf(item, SKELETON_FAMILIES, `pages[${index}]`);
    const candidate = candidateOfFamily(family);
    return { kind: "page", key: family, name: candidate.name, family, treatment: defaultTreatmentCopy() };
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

// 表現の写し (item ごとに別のオブジェクトにする)
function treatmentCopy(treatment: Treatment): Treatment {
  return { ...treatment, motionSamples: [...treatment.motionSamples] };
}

// 今回保存する 1 件の item。同じ kind かつ同じ key の item があれば入れ替える (足した順)
function mergeSavedItems(existing: SavedItem[], addition: SavedItem | null): SavedItem[] {
  const merged = [...existing];
  if (addition === null) return merged;
  const index = merged.findIndex((entry) => entry.kind === addition.kind && entry.key === addition.key);
  if (index < 0) merged.push(addition);
  else merged[index] = addition;
  return merged;
}

// ページの item。key は pageKeyOf、treatment は保存するときの写し
function pageItemOf(pageType: PageType, treatment: Treatment): PageItem {
  return { kind: "page", key: pageKeyOf(pageType), name: pageType.name, family: pageType.family, treatment: treatmentCopy(treatment) };
}

// 部品の側の item。key と name は componentItemIdentity が決める
function componentItemOf(target: ComponentTarget, treatment: Treatment): ComponentSheetItem | ComponentItem {
  const identity = componentItemIdentity(target);
  const item = { key: identity.key, name: identity.name, treatment: treatmentCopy(treatment) };
  return target.kind === "component-sheet" ? { kind: "component-sheet", ...item } : { kind: "component", ...item };
}

// デザインガイドの item。key と name は固定で、treatment は保存するときの写し
function designGuideItemOf(treatment: Treatment): DesignGuideItem {
  return { kind: "design-guide", key: DESIGN_GUIDE_KEY, name: DESIGN_GUIDE_NAME, treatment: treatmentCopy(treatment) };
}

// 今回の保存で items に足す 1 件の指定。同時に指定できるのは 1 つだけ
type Addition = { pageType?: PageType; target?: ComponentTarget; designGuide?: boolean };

// 今回の保存で items に足す 1 件 (ページ・部品の側・デザインガイド。指定が無ければ null)
function additionOf(addition: Addition, treatment: Treatment): SavedItem | null {
  if (addition.pageType !== undefined) return pageItemOf(addition.pageType, treatment);
  if (addition.target !== undefined) return componentItemOf(addition.target, treatment);
  if (addition.designGuide === true) return designGuideItemOf(treatment);
  return null;
}

export type SaveProjectInput = {
  project: unknown; // 検証してから保存する (CLI はファイルから読んだ JSON を渡す)
  themeCss?: string;
  page?: { pageType: PageType; html: string };
  component?: { target: ComponentTarget; html: string };
  designGuide?: { files: DesignGuideFile[] };
};

// page・component・designGuide のうち指定されたものの数 (2 つ以上は同時に保存できない)
function additionCount(input: SaveProjectInput): number {
  return [input.page, input.component, input.designGuide].filter((value) => value !== undefined).length;
}

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

// ページの html を pages/<key>.html に書く
function writePageHtml(dir: string, html: string, pageType: PageType): void {
  const key = pageKeyOf(pageType);
  const pagesDir = join(dir, PAGES_DIR);
  mkdirSync(pagesDir, { recursive: true });
  writeFileAt(join(pagesDir, `${key}.html`), html, `${key}.html`);
}

// 部品 (部品帳を含む) の html を components/<key>.html に書く
function writeComponentHtml(dir: string, html: string, target: ComponentTarget): void {
  const key = componentItemIdentity(target).key;
  const componentsDir = join(dir, COMPONENTS_DIR);
  mkdirSync(componentsDir, { recursive: true });
  writeFileAt(join(componentsDir, `${key}.html`), html, `${key}.html`);
}

// 中身のファイルを先に書く (project.json は保存の最後に書く)
function writeContentFiles(
  input: SaveProjectInput,
  dir: string,
  pageType: PageType | undefined,
  target: ComponentTarget | undefined,
  designGuideFiles: DesignGuideFile[] | undefined,
): void {
  if (input.themeCss !== undefined) writeFileAt(join(dir, THEME_FILE), input.themeCss, "theme.css");
  if (input.page !== undefined && pageType !== undefined) writePageHtml(dir, input.page.html, pageType);
  if (input.component !== undefined && target !== undefined) writeComponentHtml(dir, input.component.html, target);
  if (designGuideFiles !== undefined) writeDesignGuideFolder(join(dir, DESIGN_GUIDE_DIR), designGuideFiles);
}

/** プロジェクトを保存する。createdAt は初回だけ、updatedAt は毎回今の時刻にする */
export function saveProject(env: NodeJS.ProcessEnv, input: SaveProjectInput): Project {
  if (additionCount(input) >= 2) {
    throw inputError("page・component・designGuide は 2 つ以上同時に指定できません");
  }
  // ファイルの誤りは何も書く前に止める (プロジェクトも保存しない)
  const designGuideFiles = input.designGuide === undefined ? undefined : validateDesignGuideFiles(input.designGuide.files);
  const content = validateProjectContent(input.project);
  const pageType = input.page === undefined ? undefined : pageTypeWithFamily(input.page.pageType);
  const target = input.component === undefined ? undefined : validateComponentTarget(input.component.target);
  const designGuide = input.designGuide !== undefined;
  const dir = projectDir(env, content.id);
  const existing = readExistingForSave(env, content.id);
  const now = new Date().toISOString();
  const project: Project = {
    ...content,
    items: mergeSavedItems(existing?.project.items ?? [], additionOf({ pageType, target, designGuide }, content.treatment)),
    createdAt: existing?.project.createdAt ?? now,
    updatedAt: now,
  };
  mkdirSync(dir, { recursive: true });
  writeContentFiles(input, dir, pageType, target, designGuideFiles);
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

/** 部品 (部品帳を含む) の html を読む。無ければ null。key は componentKeyOf が作る形の文字列 */
export function readComponent(env: NodeJS.ProcessEnv, id: string, key: string): string | null {
  const componentKey = keyOf(key, "key");
  const file = join(projectDir(env, id), COMPONENTS_DIR, `${componentKey}.html`);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw new CliExit(EXIT_INPUT, { error: "file", file: `${componentKey}.html`, path: file, message: errorMessage(e) });
  }
}

/** デザインガイドのフォルダ (<project>/design-guide) の絶対パス */
export function designGuideDir(env: NodeJS.ProcessEnv, id: string): string {
  return join(projectDir(env, id), DESIGN_GUIDE_DIR);
}

/** デザインガイドのファイルを読む。DESIGN_GUIDE_FILE_NAMES に無い名前 (例 ../project.json)・無いファイルは null */
export function readDesignGuideFile(env: NodeJS.ProcessEnv, id: string, name: string): string | null {
  if (!(DESIGN_GUIDE_FILE_NAMES as readonly string[]).includes(name)) return null;
  const file = join(designGuideDir(env, id), name);
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (isNotFound(e)) return null;
    throw new CliExit(EXIT_INPUT, { error: "file", file: name, path: file, message: errorMessage(e) });
  }
}

export type ProjectSummary = {
  id: string;
  what: string;
  pageType: PageType;
  name: string;
  items: SavedItem[];
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
    items: project.items,
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
