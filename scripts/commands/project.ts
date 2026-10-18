// プロジェクト (1 つの依頼から作ったもの) の保存・一覧・表示。中身は core/project.ts が持つ
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { DESIGN_GUIDE_FILE_NAMES } from "../../core/design-guide.ts";
import type { DesignGuideFile } from "../../core/design-guide.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { candidateOf, validatePageType } from "../../core/page-type.ts";
import { listProjectsWithBroken, projectDir, readProject, saveProject } from "../../core/project.ts";
import type { ComponentTarget, PageType, Project } from "../../core/types.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// テキストファイルを読む。読めないときは CliExit(1, {error:"file"})
function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: label, path, message: errorMessage(e) });
  }
}

// --page-name [--family] から画面の種類を作る。
// 候補の名前なら family は候補のものを使い、自由な名前なら --family が要る
function parsePageType(name: string, family: string | undefined): PageType {
  const candidate = candidateOf(name);
  if (candidate !== undefined) {
    if (family !== undefined && family !== candidate.family) {
      throw new CliExit(EXIT_INPUT, {
        error: "input",
        message: `候補の名前「${candidate.name}」の骨組みの種類は ${candidate.family} です: ${family}`,
      });
    }
    return candidate;
  }
  if (family === undefined) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `自由な名前の画面の種類には --family を指定してください: ${name}` });
  }
  const parsed = validatePageType({ name, family });
  // family を渡しているので parsed.family は必ずある (validatePageType は family があるときだけ返す)
  if (parsed.family === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な骨組みの種類です: ${family}` });
  return { name: parsed.name, family: parsed.family };
}

type RawSaveArgs = {
  project: string | undefined;
  themeCss: string | undefined;
  pageName: string | undefined;
  family: string | undefined;
  component: string | undefined;
  componentSheet: boolean | undefined;
  html: string | undefined;
  designGuide: string | undefined;
};
type SaveArgs = {
  project: string;
  themeCss: string | undefined;
  page: { pageType: PageType; html: string } | undefined;
  component: { target: ComponentTarget; html: string } | undefined;
  designGuideDir: string | undefined;
};

// 作るものの指定 (--page-name / --component / --component-sheet / --design-guide のどれか 1 つ) と、その --html
type PageMake = { kind: "page"; pageName: string; family: string | undefined; html: string };
type ComponentMake = { kind: "component"; name: string; html: string };
type ComponentSheetMake = { kind: "component-sheet"; html: string };
type DesignGuideMake = { kind: "design-guide"; dir: string };
type MakeSpec = PageMake | ComponentMake | ComponentSheetMake | DesignGuideMake;

const HTML_NEEDS_MAKE = "--html は --page-name / --component / --component-sheet のどれか 1 つといっしょに指定してください";
const DESIGN_GUIDE_NEEDS_DIR = "--design-guide にはデザインガイドのフォルダを指定してください";

// save の --flag を読む。知らない引数・値の欠けは usage
function readSaveArgs(args: string[]): RawSaveArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        project: { type: "string" },
        "theme-css": { type: "string" },
        "page-name": { type: "string" },
        family: { type: "string" },
        component: { type: "string" },
        "component-sheet": { type: "boolean" },
        html: { type: "string" },
        "design-guide": { type: "string" },
      },
    });
    return {
      project: parsed.values.project,
      themeCss: parsed.values["theme-css"],
      pageName: parsed.values["page-name"],
      family: parsed.values.family,
      component: parsed.values.component,
      componentSheet: parsed.values["component-sheet"],
      html: parsed.values.html,
      designGuide: parsed.values["design-guide"],
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// 付いた作るものの指定の名前 (2 つ以上を usage にするのに使う)
function makeKindsOf(raw: RawSaveArgs): string[] {
  const kinds: string[] = [];
  if (raw.pageName !== undefined) kinds.push("--page-name");
  if (raw.component !== undefined) kinds.push("--component");
  if (raw.componentSheet === true) kinds.push("--component-sheet");
  if (raw.designGuide !== undefined) kinds.push("--design-guide");
  return kinds;
}

// 作るものの指定には --html が要る
function requireHtml(html: string | undefined): string {
  if (html === undefined) throw usage(HTML_NEEDS_MAKE);
  return html;
}

// 作るものの指定を読む。どれか 1 つまでで、--html がそろっていることを確かめる
function makeOf(raw: RawSaveArgs): MakeSpec | undefined {
  const kinds = makeKindsOf(raw);
  if (kinds.length > 1) throw usage(`${kinds.join(" と ")} は同時に指定できません`);
  if (raw.family !== undefined && raw.pageName === undefined) throw usage("--family は --page-name といっしょに指定してください");
  if (raw.designGuide !== undefined) {
    if (raw.html !== undefined) throw usage("--design-guide と --html は同時に指定できません");
    return { kind: "design-guide", dir: raw.designGuide };
  }
  if (raw.pageName !== undefined) return { kind: "page", pageName: raw.pageName, family: raw.family, html: requireHtml(raw.html) };
  if (raw.component !== undefined) return { kind: "component", name: raw.component, html: requireHtml(raw.html) };
  if (raw.componentSheet === true) return { kind: "component-sheet", html: requireHtml(raw.html) };
  if (raw.html !== undefined) throw usage(HTML_NEEDS_MAKE);
  return undefined;
}

// ページの保存の指定。--page-name [--family] と --html
function pageOf(make: PageMake): { pageType: PageType; html: string } {
  return { pageType: parsePageType(make.pageName, make.family), html: make.html };
}

// 部品の側 (部品帳・部品) の保存の指定。名前の検証は saveProject (core) が行う
function componentOf(make: ComponentMake | ComponentSheetMake): { target: ComponentTarget; html: string } {
  const target: ComponentTarget = make.kind === "component" ? { kind: "component", name: make.name } : { kind: "component-sheet" };
  return { target, html: make.html };
}

// --design-guide のフォルダを読む。フォルダが無ければ input の誤り。
// DESIGN_GUIDE_FILE_NAMES のうち置かれているものだけを順に読み、中身の検証は saveProject (core) に任せる
function readDesignGuideFiles(dir: string): DesignGuideFile[] {
  const folder = resolve(dir);
  if (!existsSync(folder)) throw new CliExit(EXIT_INPUT, { error: "input", message: `${DESIGN_GUIDE_NEEDS_DIR}: ${dir}` });
  return DESIGN_GUIDE_FILE_NAMES.flatMap((name) => {
    const file = join(folder, name);
    return existsSync(file) ? [{ name, content: readTextFile(file, name) }] : [];
  });
}

// 作るものの指定を保存の引数に直す。--family は --page-name といっしょのときだけ使う
function saveArgsOf(raw: RawSaveArgs): SaveArgs {
  const { project, themeCss } = raw;
  if (project === undefined) throw usage("--project <file> を指定してください");
  const make = makeOf(raw);
  if (make === undefined) return { project, themeCss, page: undefined, component: undefined, designGuideDir: undefined };
  if (make.kind === "page") return { project, themeCss, page: pageOf(make), component: undefined, designGuideDir: undefined };
  if (make.kind === "design-guide") {
    return { project, themeCss, page: undefined, component: undefined, designGuideDir: make.dir };
  }
  return { project, themeCss, page: undefined, component: componentOf(make), designGuideDir: undefined };
}

// save の応答。dir は projectDir で組み立てる
function saveResult(args: string[], env: NodeJS.ProcessEnv): { project: Project; dir: string } {
  const opts = saveArgsOf(readSaveArgs(args));
  const themeCss = opts.themeCss === undefined ? undefined : readTextFile(opts.themeCss, "theme-css");
  const page = opts.page === undefined ? undefined : { pageType: opts.page.pageType, html: readTextFile(opts.page.html, "html") };
  const component =
    opts.component === undefined ? undefined : { target: opts.component.target, html: readTextFile(opts.component.html, "html") };
  const designGuide = opts.designGuideDir === undefined ? undefined : { files: readDesignGuideFiles(opts.designGuideDir) };
  const project = saveProject(env, { project: readJsonFile(opts.project, "project"), themeCss, page, component, designGuide });
  return { project, dir: projectDir(env, project.id) };
}

// show の応答。無い id は input エラー
function showResult(id: string, env: NodeJS.ProcessEnv): { project: Project; dir: string } {
  const found = readProject(env, id);
  if (found === null) throw new CliExit(EXIT_INPUT, { error: "input", message: `知らないプロジェクトです: ${id}`, id });
  return found;
}

// show の id を読む (ちょうど 1 つ)
function showIdOf(rest: string[]): string {
  const [id, ...extra] = rest;
  if (id === undefined) throw usage("project show <id> のように id を指定してください");
  if (extra.length > 0) throw usage(`project show の引数は 1 つだけです: ${extra.join(" ")}`);
  return id;
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const [subcommand, ...rest] = args;
  if (subcommand === "save") return Promise.resolve(saveResult(rest, env));
  if (subcommand === "list") {
    if (rest.length > 0) throw usage(`project list に引数は付けられません: ${rest.join(" ")}`);
    return Promise.resolve(listProjectsWithBroken(env));
  }
  if (subcommand === "show") return Promise.resolve(showResult(showIdOf(rest), env));
  if (subcommand === undefined) throw usage("project にサブコマンド (save / list / show) を指定してください");
  throw usage(`不明なサブコマンドです (save / list / show): ${subcommand}`);
}
