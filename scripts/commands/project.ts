// プロジェクト (1 つの依頼から作ったもの) の保存・一覧・表示。中身は core/project.ts が持つ
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { listProjectsWithBroken, projectDir, readProject, saveProject } from "../../core/project.ts";
import { PAGE_TYPES } from "../../core/types.ts";
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

// --page-type の値を PAGE_TYPES のいずれかにする
function parsePageType(value: string): PageType {
  const pageType = PAGE_TYPES.find((candidate) => candidate === value);
  if (pageType === undefined)
    throw new CliExit(EXIT_INPUT, { error: "input", message: `不明なページの種類です: ${value}`, pageTypes: PAGE_TYPES });
  return pageType;
}

type RawSaveArgs = { project: string | undefined; themeCss: string | undefined; pageType: string | undefined; html: string | undefined };
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
        "page-type": { type: "string" },
        html: { type: "string" },
      },
    });
    return {
      project: parsed.values.project,
      themeCss: parsed.values["theme-css"],
      pageType: parsed.values["page-type"],
      html: parsed.values.html,
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// --page-type と --html は両方そろっているときだけページにする
function saveArgsOf(raw: RawSaveArgs): SaveArgs {
  const { project, themeCss, pageType, html } = raw;
  if (project === undefined) throw usage("--project <file> を指定してください");
  if (pageType === undefined && html === undefined) return { project, themeCss, page: undefined };
  if (pageType === undefined || html === undefined) throw usage("--page-type と --html は両方いっしょに指定してください");
  return { project, themeCss, page: { pageType: parsePageType(pageType), html } };
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
