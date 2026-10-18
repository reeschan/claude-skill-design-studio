// 表現の一覧と、動きの見本 1 件を殻に入れた HTML を返す。HTML を描く流れは core/direction.ts に倣う
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_EXTERNAL, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { findStyle } from "../../core/styles.ts";
import { renderTheme, stripTailwindImport } from "../../core/theme-bridge.ts";
import type { ThemeSummary } from "../../core/theme-bridge.ts";
import { findMotion, motionSampleHtml, treatmentListing } from "../../core/treatment.ts";
import type { BaseMode, Seed, Style } from "../../core/types.ts";

const BASE_MODES: readonly BaseMode[] = ["light", "dark"];
const DEFAULT_STYLE = "minimal";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type MotionArgs = { id: string; style: string; mode: string | undefined; out: string | undefined };

// `motion` のあとの引数を読む。位置引数は見本の id だけ
function readMotionArgs(args: string[]): MotionArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        style: { type: "string" },
        mode: { type: "string" },
        out: { type: "string" },
      },
    });
    const [id, ...extra] = parsed.positionals;
    if (id === undefined || extra.length > 0) throw usage("treatments motion は <id> を 1 つ指定してください");
    return { id, style: parsed.values.style ?? DEFAULT_STYLE, mode: parsed.values.mode, out: parsed.values.out };
  } catch (e) {
    if (e instanceof CliExit) throw e;
    throw usage(errorMessage(e));
  }
}

// --style をスタイルにする。無ければ入力の誤り
function styleOf(id: string): Style {
  const style = findStyle(id);
  if (style === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な --style: ${id}` });
  return style;
}

// --mode を light / dark のいずれかにする。無ければ seed.baseMode
function modeOf(value: string | undefined, seed: Seed): BaseMode {
  if (value === undefined) return seed.baseMode;
  const mode = BASE_MODES.find((candidate) => candidate === value);
  if (mode === undefined) {
    throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な --mode: ${value}`, modes: BASE_MODES });
  }
  return mode;
}

// style-guide の summary から種の id のものを選ぶ。無ければ先頭。それも無ければ外部の失敗
function summaryOf(summary: ThemeSummary[], seedId: string): ThemeSummary {
  const found = summary.find((entry) => entry.id === seedId) ?? summary[0];
  if (found === undefined) throw new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message: "summary が空です" });
  return found;
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
  const [first, ...rest] = args;
  if (first === undefined) return treatmentListing();
  if (first !== "motion") throw usage(`treatments に知らない引数があります: ${args.join(" ")}`);
  const raw = readMotionArgs(rest);
  const sample = findMotion(raw.id);
  if (sample === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な動きの見本です: ${raw.id}` });
  const style = styleOf(raw.style);
  const mode = modeOf(raw.mode, style.seed);
  const theme = await renderTheme([style.seed], env);
  const summary = summaryOf(theme.summary, style.seed.id);
  const html = motionSampleHtml(sample, {
    themeId: style.seed.id,
    mode,
    cssForPage: stripTailwindImport(theme.css),
    fontsUrl: summary.fontsUrl,
  });
  if (raw.out === undefined) return { id: sample.id, style: style.id, mode, file: null, html };
  writeOut(raw.out, html);
  return { id: sample.id, style: style.id, mode, file: raw.out, html: null };
}
