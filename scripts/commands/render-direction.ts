// 方向性を骨組みで描く。中身は core/direction.ts が持つ
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { renderDirection } from "../../core/direction.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { findStyle, validateDirection } from "../../core/styles.ts";
import { PAGE_TYPES } from "../../core/types.ts";
import type { BaseMode, Direction, PageType } from "../../core/types.ts";

const BASE_MODES: readonly BaseMode[] = ["light", "dark"];

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type RawArgs = {
  direction: string | undefined;
  style: string | undefined;
  pageType: string | undefined;
  mode: string | undefined;
  out: string | undefined;
};

// 引数を読む。知らない引数・値の欠けは usage
function readArgs(args: string[]): RawArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        direction: { type: "string" },
        style: { type: "string" },
        "page-type": { type: "string" },
        mode: { type: "string" },
        out: { type: "string" },
      },
    });
    return {
      direction: parsed.values.direction,
      style: parsed.values.style,
      pageType: parsed.values["page-type"],
      mode: parsed.values.mode,
      out: parsed.values.out,
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// --direction <file> か --style <id> のどちらか 1 つから方向性を決める
function directionOf(raw: RawArgs): Direction {
  if (raw.direction !== undefined && raw.style !== undefined) throw usage("--direction と --style は同時に指定できません");
  if (raw.direction !== undefined) return validateDirection(readJsonFile(raw.direction, "direction"));
  if (raw.style !== undefined) {
    const style = findStyle(raw.style);
    if (style === undefined) throw usage(`不明な --style: ${raw.style}`);
    return style;
  }
  throw usage("--direction <file> か --style <id> を指定してください");
}

// --page-type を PAGE_TYPES のいずれかにする
function pageTypeOf(raw: RawArgs): PageType {
  const value = raw.pageType;
  if (value === undefined) throw usage("--page-type <lp|dashboard|blog> を指定してください");
  const pageType = PAGE_TYPES.find((candidate) => candidate === value);
  if (pageType === undefined) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `不明なページの種類です: ${value}`, pageTypes: PAGE_TYPES });
  }
  return pageType;
}

// --mode を light / dark のいずれかにする。無ければ undefined (seed.baseMode を使う)
function modeOf(raw: RawArgs): BaseMode | undefined {
  const value = raw.mode;
  if (value === undefined) return undefined;
  const mode = BASE_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な --mode: ${value}`, modes: BASE_MODES });
  }
  return mode;
}

// --out のファイルに書く。書けなければ CliExit(1, {error:"file"})
function writeOut(path: string, html: string): void {
  try {
    writeFileSync(path, html, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: "out", path, message: errorMessage(e) });
  }
}

export async function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const raw = readArgs(args);
  const direction = directionOf(raw);
  const pageType = pageTypeOf(raw);
  const mode = modeOf(raw) ?? direction.seed.baseMode;
  const { themeId, layout, checks, failed, html } = await renderDirection({ direction, pageType, mode }, env);
  if (raw.out === undefined) return { themeId, pageType, layout, mode, file: null, html, checks, failed };
  writeOut(raw.out, html);
  return { themeId, pageType, layout, mode, file: raw.out, html: null, checks, failed };
}
