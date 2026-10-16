// テーマの種から style-guide の CLI (`render --seed`) を別プロセスで呼ぶ橋渡し (theme bridge)。
// 両者の約束は CLI の入出力だけにする (ADR 0001)
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliExit, EXIT_ACTION, EXIT_EXTERNAL } from "./cli-exit.ts";
import { styleGuideDir } from "./paths.ts";
import type { BaseMode, Seed } from "./types.ts";

export type CheckCounts = { pass: number; total: number; adjusted: number };
export type ThemeSummary = { id: string; name: string; fontsUrl: string; checks: Record<BaseMode, CheckCounts> };
export type RenderThemeResult = { css: string; themes: unknown[]; summary: ThemeSummary[]; failed: number };

type PipelineResult = { code: number; stdout: string; stderr: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const outputError = (message: string): CliExit => new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message });

// theme.css の先頭の @import "tailwindcss"; の行
const TAILWIND_IMPORT = /^[ \t]*@import\s+["']tailwindcss["'];?[ \t]*(?:\r?\n)?/;

/** theme.css の先頭の `@import "tailwindcss";` の行を除く。骨組みやページでは Tailwind を別途読み込む */
export function stripTailwindImport(css: string): string {
  return css.replace(TAILWIND_IMPORT, "");
}

/** style-guide の pipeline.ts を子プロセスで起動する */
function runPipeline(pipeline: string, seedFile: string, env: NodeJS.ProcessEnv): Promise<PipelineResult> {
  const args = [pipeline, "render", "--seed", seedFile];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) return resolve({ code: 0, stdout, stderr });
      if (typeof error.code !== "number") {
        return reject(new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message: error.message }));
      }
      resolve({ code: error.code, stdout, stderr });
    });
  });
}

// 標準エラーの JSON を読む。読めなければ null
function parseStderrJson(stderr: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stderr.trim());
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 失敗の種類を分ける。error が usage で message に --seed か render が入るのは、render を持たない
// 古い style-guide の印 (2)。本物の古い版はサブコマンドの振り分け前に parseArgs で止まり
// "Unknown option '--seed'." を返すため、--seed も見る。それ以外は外部の失敗 (3)
function pipelineFailure(res: PipelineResult, dir: string): CliExit {
  const payload = parseStderrJson(res.stderr);
  const message = payload?.message;
  const outdated = typeof message === "string" && (message.includes("--seed") || message.includes("render"));
  if (payload?.error === "usage" && outdated) {
    return new CliExit(EXIT_ACTION, { error: "style-guide-outdated", dir });
  }
  return new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", stderr: res.stderr.trim() });
}

function countOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw outputError(`${label} は数値ではありません`);
  return value;
}

function checksOf(value: unknown, label: string): CheckCounts {
  if (!isRecord(value)) throw outputError(`${label} はオブジェクトではありません`);
  return {
    pass: countOf(value.pass, `${label}.pass`),
    total: countOf(value.total, `${label}.total`),
    adjusted: countOf(value.adjusted, `${label}.adjusted`),
  };
}

function summaryOf(value: unknown, index: number): ThemeSummary {
  if (!isRecord(value)) throw outputError(`summary[${index}] はオブジェクトではありません`);
  const { id, name, fontsUrl, checks } = value;
  if (typeof id !== "string" || typeof name !== "string" || typeof fontsUrl !== "string") {
    throw outputError(`summary[${index}] の id / name / fontsUrl は文字列で指定してください`);
  }
  if (!isRecord(checks)) throw outputError(`summary[${index}].checks はオブジェクトではありません`);
  return {
    id,
    name,
    fontsUrl,
    checks: { light: checksOf(checks.light, "summary.checks.light"), dark: checksOf(checks.dark, "summary.checks.dark") },
  };
}

// 成功したときの応答を検証する
function renderOutput(x: unknown): RenderThemeResult {
  if (!isRecord(x)) throw outputError("応答はオブジェクトではありません");
  const { css, themes, summary, failed } = x;
  if (typeof css !== "string") throw outputError("css は文字列ではありません");
  if (!Array.isArray(themes)) throw outputError("themes は配列ではありません");
  if (!Array.isArray(summary)) throw outputError("summary は配列ではありません");
  if (typeof failed !== "number" || !Number.isFinite(failed)) throw outputError("failed は数値ではありません");
  return { css, themes, summary: summary.map((entry, index) => summaryOf(entry, index)), failed };
}

function parseStdout(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw outputError("標準出力を JSON として読めません");
  }
}

/** Seed の配列を style-guide の `render --seed` に渡し、theme.css と結果を受け取る */
export async function renderTheme(seeds: Seed[], env: NodeJS.ProcessEnv): Promise<RenderThemeResult> {
  const dir = styleGuideDir(env);
  const pipeline = join(dir, "scripts", "pipeline.ts");
  if (!existsSync(pipeline)) throw new CliExit(EXIT_ACTION, { error: "style-guide-missing", dir });
  const tmp = mkdtempSync(join(tmpdir(), "design-studio-render-"));
  try {
    const seedFile = join(tmp, "seeds.json");
    writeFileSync(seedFile, JSON.stringify(seeds), "utf8");
    const res = await runPipeline(pipeline, seedFile, env);
    if (res.code !== 0) throw pipelineFailure(res, dir);
    return renderOutput(parseStdout(res.stdout));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
