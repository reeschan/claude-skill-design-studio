// プロジェクト (1 つの依頼から作ったもの) の保存・一覧・表示。中身は core/project.ts が持つ
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { candidateOf, validatePageType } from "../../core/page-type.ts";
import { listProjectsWithBroken, projectDir, readProject, saveProject } from "../../core/project.ts";
import type { PageType, Project } from "../../core/types.ts";

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
  html: string | undefined;
};
type SaveArgs = { project: string; themeCss: string | undefined; page: { pageType: PageType; html: string } | undefined };

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
        html: { type: "string" },
      },
    });
    return {
      project: parsed.values.project,
      themeCss: parsed.values["theme-css"],
      pageName: parsed.values["page-name"],
      family: parsed.values.family,
      html: parsed.values.html,
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// --page-name と --html は両方そろっているときだけページにする。--family は --page-name といっしょに使う
function saveArgsOf(raw: RawSaveArgs): SaveArgs {
  const { project, themeCss, pageName, family, html } = raw;
  if (project === undefined) throw usage("--project <file> を指定してください");
  if (pageName === undefined && html === undefined) {
    if (family !== undefined) throw usage("--family は --page-name といっしょに指定してください");
    return { project, themeCss, page: undefined };
  }
  if (pageName === undefined || html === undefined) throw usage("--page-name と --html は両方いっしょに指定してください");
  return { project, themeCss, page: { pageType: parsePageType(pageName, family), html } };
}

// save の応答。dir は projectDir で組み立てる
function saveResult(args: string[], env: NodeJS.ProcessEnv): { project: Project; dir: string } {
  const opts = saveArgsOf(readSaveArgs(args));
  const themeCss = opts.themeCss === undefined ? undefined : readTextFile(opts.themeCss, "theme-css");
  const page = opts.page === undefined ? undefined : { pageType: opts.page.pageType, html: readTextFile(opts.page.html, "html") };
  const project = saveProject(env, { project: readJsonFile(opts.project, "project"), themeCss, page });
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
