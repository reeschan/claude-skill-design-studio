// style か direction の種から style-guide でテーマを作る
import { parseArgs } from "node:util";
import { CliExit, EXIT_EXTERNAL, usage } from "../../core/cli-exit.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { findStyle, validateDirection } from "../../core/styles.ts";
import { renderTheme, stripTailwindImport } from "../../core/theme-bridge.ts";
import type { ThemeSummary } from "../../core/theme-bridge.ts";
import type { Seed, Style } from "../../core/types.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --style <id> か --direction <file> を読む
function parseThemeArgs(args: string[]): { style: string | undefined; direction: string | undefined } {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: { style: { type: "string" }, direction: { type: "string" } },
    });
    return { style: parsed.values.style, direction: parsed.values.direction };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

function requireStyle(id: string): Style {
  const style = findStyle(id);
  if (style === undefined) throw usage(`不明な --style: ${id}`);
  return style;
}

// 指定された 1 つから種を決める。direction のファイルは検証してから使う
function seedOf(args: { style: string | undefined; direction: string | undefined }): Seed {
  const { style, direction } = args;
  if (style !== undefined && direction !== undefined) throw usage("--style と --direction は同時に指定できません");
  if (style !== undefined) return requireStyle(style).seed;
  if (direction !== undefined) return validateDirection(readJsonFile(direction, "direction")).seed;
  throw usage("--style <id> か --direction <file> を指定してください");
}

// 種に対応する summary を選ぶ。無ければ先頭。それも無ければ外部の失敗にする
function summaryOf(summary: ThemeSummary[], seedId: string): ThemeSummary {
  const found = summary.find((s) => s.id === seedId) ?? summary[0];
  if (found === undefined) throw new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message: "summary が空です" });
  return found;
}

export async function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const seed = seedOf(parseThemeArgs(args));
  const result = await renderTheme([seed], env);
  const summary = summaryOf(result.summary, seed.id);
  return {
    themeId: seed.id,
    css: result.css,
    cssForPage: stripTailwindImport(result.css),
    fontsUrl: summary.fontsUrl,
    checks: summary.checks,
    failed: result.failed,
  };
}
