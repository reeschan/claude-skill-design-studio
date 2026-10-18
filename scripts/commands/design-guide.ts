// デザインガイドのファイル一式を組み立ててフォルダに書く。中身は core/design-guide-build.ts が持つ
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { buildDesignGuide } from "../../core/design-guide-build.ts";
import { validateDesignGuideValues, writeDesignGuideFolder } from "../../core/design-guide.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { findStyle, validateDirection } from "../../core/styles.ts";
import { DEFAULT_TREATMENT, validateTreatment } from "../../core/treatment.ts";
import type { Direction, Treatment } from "../../core/types.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type RawArgs = {
  direction: string | undefined;
  style: string | undefined;
  sheet: string | undefined;
  values: string | undefined;
  out: string | undefined;
  treatment: string | undefined;
};
type GuideArgs = { direction: Direction; sheet: string; values: string; out: string; treatment: string | undefined };

// --direction <file> / --style <id> / --sheet <file> / --values <file> / --out <dir> / [--treatment '<JSON>'] を読む。
// 知らない引数は usage
function readArgs(args: string[]): RawArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        direction: { type: "string" },
        style: { type: "string" },
        sheet: { type: "string" },
        values: { type: "string" },
        out: { type: "string" },
        treatment: { type: "string" },
      },
    });
    return {
      direction: parsed.values.direction,
      style: parsed.values.style,
      sheet: parsed.values.sheet,
      values: parsed.values.values,
      out: parsed.values.out,
      treatment: parsed.values.treatment,
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// --direction <file> か --style <id> のどちらか 1 つから方向性を作る (theme サブコマンドと同じ読み方)
function directionOf(args: RawArgs): Direction {
  const { direction, style } = args;
  if (direction !== undefined && style !== undefined) throw usage("--direction と --style は同時に指定できません");
  if (style !== undefined) {
    const found = findStyle(style);
    if (found === undefined) throw usage(`不明な --style: ${style}`);
    return found;
  }
  if (direction !== undefined) return validateDirection(readJsonFile(direction, "direction"));
  throw usage("--direction <file> か --style <id> を指定してください");
}

// 必須の --sheet・--values・--out と、方向性をまとめる。欠けは usage
function guideArgsOf(args: RawArgs): GuideArgs {
  const { sheet, values, out } = args;
  if (sheet === undefined || values === undefined || out === undefined) {
    throw usage("design-guide は --sheet <file> --values <file> --out <dir> を指定してください");
  }
  return { direction: directionOf(args), sheet, values, out, treatment: args.treatment };
}

// --treatment のインラインの JSON を読む。壊れていれば usage (mix の --points と同じ)
function treatmentOf(value: string | undefined): Treatment {
  if (value === undefined) return DEFAULT_TREATMENT;
  try {
    return validateTreatment(JSON.parse(value));
  } catch (e) {
    if (e instanceof CliExit) throw e;
    throw usage(`--treatment は JSON で指定してください: ${errorMessage(e)}`);
  }
}

// テキストファイルを読む。読めないときは CliExit(1, {error:"file"})
function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: label, path, message: errorMessage(e) });
  }
}

export async function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const parsed = guideArgsOf(readArgs(args));
  const sheetHtml = readTextFile(parsed.sheet, "sheet");
  const values = validateDesignGuideValues(readJsonFile(parsed.values, "values"));
  const build = await buildDesignGuide({ direction: parsed.direction, treatment: treatmentOf(parsed.treatment), sheetHtml, values }, env);
  const dir = writeDesignGuideFolder(parsed.out, build.files);
  return { dir, styleGuide: build.styleGuide, notice: build.notice, files: build.files.map((file) => file.name) };
}
