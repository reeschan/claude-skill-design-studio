// 方向性を骨組みで描く。中身は core/direction.ts が持つ
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { renderDirection } from "../../core/direction.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { findStyle, validateDirection } from "../../core/styles.ts";
import { SKELETON_FAMILIES } from "../../core/types.ts";
import type { BaseMode, Direction, SkeletonFamily } from "../../core/types.ts";

const BASE_MODES: readonly BaseMode[] = ["light", "dark"];

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type RawArgs = {
  direction: string | undefined;
  style: string | undefined;
  family: string | undefined;
  mode: string | undefined;
  surface: string | undefined;
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
        family: { type: "string" },
        mode: { type: "string" },
        surface: { type: "string" },
        out: { type: "string" },
      },
    });
    return {
      direction: parsed.values.direction,
      style: parsed.values.style,
      family: parsed.values.family,
      mode: parsed.values.mode,
      surface: parsed.values.surface,
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

// --family を SKELETON_FAMILIES のいずれかにする
function familyOf(raw: RawArgs): SkeletonFamily {
  const value = raw.family;
  if (value === undefined) throw usage(`--family <${SKELETON_FAMILIES.join("|")}> を指定してください`);
  const family = SKELETON_FAMILIES.find((candidate) => candidate === value);
  if (family === undefined) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な骨組みの種類です: ${value}`, families: SKELETON_FAMILIES });
  }
  return family;
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
  const family = familyOf(raw);
  const mode = modeOf(raw) ?? direction.seed.baseMode;
  const { themeId, layout, surface, checks, failed, html } = await renderDirection({ direction, family, mode, surface: raw.surface }, env);
  if (raw.out === undefined) return { themeId, family, layout, mode, surface, file: null, html, checks, failed };
  writeOut(raw.out, html);
  return { themeId, family, layout, mode, surface, file: raw.out, html: null, checks, failed };
}
