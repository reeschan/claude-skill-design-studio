// 方向性を 4 つの軸 (色・フォント・形・配置) で混ぜ、テーマを作って骨組みで描く。
// 混ぜる結果は決定的にする (同じ入力なら同じ id・同じ中身)。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { renderSkeleton } from "../skeletons/index.ts";
import { CliExit, EXIT_EXTERNAL, EXIT_INPUT } from "./cli-exit.ts";
import { renderTheme, stripTailwindImport } from "./theme-bridge.ts";
import type { CheckCounts, ThemeSummary } from "./theme-bridge.ts";
import { MIX_AXES } from "./types.ts";
import type { BaseMode, Direction, MixPicks, PageType, Seed } from "./types.ts";

const MIX_ID_PREFIX = "mix-";
// タイトルに入れる画面の種類の名前
const PAGE_TYPE_LABELS: Record<PageType, string> = { lp: "LP", dashboard: "ダッシュボード", blog: "ブログ記事" };

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 4 軸すべてが 0 以上 count 未満の整数か確かめて返す。合わなければ CliExit(1) */
export function validatePicks(x: unknown, count: number): MixPicks {
  if (!isRecord(x)) throw inputError("picks はオブジェクトで指定してください");
  const picks: MixPicks = { color: 0, font: 0, shape: 0, layout: 0 };
  for (const axis of MIX_AXES) {
    const value = x[axis];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= count) {
      throw inputError(`picks.${axis} は 0 以上 ${count} 未満の整数で指定してください`);
    }
    picks[axis] = value;
  }
  return picks;
}

// 4 軸の添字を並べた id。例: mix-0121
const mixId = (picks: MixPicks): string => `${MIX_ID_PREFIX}${picks.color}${picks.font}${picks.shape}${picks.layout}`;

// 検証済みの添字で案を引く。undefined にはならないが、型を絞るために確かめる
function pickOf(directions: Direction[], index: number): Direction {
  const found = directions[index];
  if (found === undefined) throw inputError(`picks の添字が範囲外です: ${index}`);
  return found;
}

/** 4 つの軸の案を 1 つの方向性に混ぜる。色は baseMode と tone ごと、copy は常に先頭の案から取る */
export function mixDirections(directions: Direction[], picks: MixPicks): Direction {
  if (directions.length === 0) throw inputError("directions は 1 件以上で指定してください");
  const choice = validatePicks(picks, directions.length);
  const colorDirection = pickOf(directions, choice.color);
  const fontDirection = pickOf(directions, choice.font);
  const shapeDirection = pickOf(directions, choice.shape);
  const layoutDirection = pickOf(directions, choice.layout);
  const copyDirection = pickOf(directions, 0);
  const id = mixId(choice);
  const name = `${colorDirection.name} ベースのミックス`;
  const seed: Seed = {
    id,
    name,
    tone: colorDirection.seed.tone,
    baseMode: colorDirection.seed.baseMode,
    color: colorDirection.seed.color,
    shape: shapeDirection.seed.shape,
    font: fontDirection.seed.font,
  };
  const rationale = `色は「${colorDirection.name}」、フォントは「${fontDirection.name}」、形は「${shapeDirection.name}」、配置は「${layoutDirection.name}」から取ったミックス。`;
  return { id, name, rationale, seed, layouts: layoutDirection.layouts, copy: copyDirection.copy };
}

export type RenderDirectionInput = { direction: Direction; pageType: PageType; mode?: BaseMode };
export type RenderDirectionResult = {
  html: string;
  themeId: string;
  layout: string;
  checks: Record<BaseMode, CheckCounts>;
  failed: number;
};

// style-guide の summary から種の id のものを選ぶ。無ければ先頭。それも無ければ外部の失敗
function summaryOf(summary: ThemeSummary[], seedId: string): ThemeSummary {
  const found = summary.find((entry) => entry.id === seedId) ?? summary[0];
  if (found === undefined) throw new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message: "summary が空です" });
  return found;
}

/** 方向性と画面の種類からテーマを作り、骨組みで 1 枚の HTML を描く。mode を省くと seed.baseMode */
export async function renderDirection(input: RenderDirectionInput, env: NodeJS.ProcessEnv): Promise<RenderDirectionResult> {
  const { direction, pageType } = input;
  const mode = input.mode ?? direction.seed.baseMode;
  const theme = await renderTheme([direction.seed], env);
  const summary = summaryOf(theme.summary, direction.seed.id);
  const layout = direction.layouts[pageType];
  const html = renderSkeleton({
    pageType,
    layout,
    copy: direction.copy,
    mode,
    themeId: direction.seed.id,
    cssForPage: stripTailwindImport(theme.css),
    fontsUrl: summary.fontsUrl,
    title: `${direction.name}の${PAGE_TYPE_LABELS[pageType]}`,
  });
  return { html, themeId: direction.seed.id, layout, checks: summary.checks, failed: theme.failed };
}
