// 骨組みの種類 × 配置の型から骨組みを引く表と、1 枚のページ HTML に組み立てる renderSkeleton
import { CliExit, EXIT_INPUT } from "../core/cli-exit.ts";
import { pageHtml } from "../core/page-html.ts";
import type { BaseMode, Copy, Layouts, SkeletonFamily } from "../core/types.ts";
import * as blog from "./blog.ts";
import * as dashboard from "./dashboard.ts";
import * as lp from "./lp.ts";
import * as portfolio from "./portfolio.ts";
import * as pricing from "./pricing.ts";
import * as product from "./product.ts";
import * as settings from "./settings.ts";
import type { Skeleton } from "./types.ts";

export const SKELETONS: { [F in SkeletonFamily]: Record<Layouts[F], Skeleton> } = {
  lp: { centered: lp.centered, split: lp.split, fullbleed: lp.fullbleed },
  dashboard: { sidebar: dashboard.sidebar, topnav: dashboard.topnav, cards: dashboard.cards },
  blog: { classic: blog.classic, magazine: blog.magazine, minimal: blog.minimal },
  pricing: { tiers: pricing.tiers, table: pricing.table, spotlight: pricing.spotlight },
  product: { split: product.split, gallery: product.gallery, story: product.story },
  portfolio: { grid: portfolio.grid, list: portfolio.list, showcase: portfolio.showcase },
  settings: { sidebar: settings.sidebar, tabs: settings.tabs, stacked: settings.stacked },
};

export type SkeletonRequest = {
  family: SkeletonFamily;
  layout: string; // LAYOUTS[family] のいずれか。外れていれば CliExit(1)
  copy: Copy;
  mode: BaseMode;
  themeId: string;
  cssForPage: string;
  fontsUrl: string;
  title: string;
  surfaceCss?: string; // 面の台帳の CSS。空・省略なら層を足さない (骨組みの HTML を変えない)
};

function pickSkeleton<F extends SkeletonFamily>(family: F, layout: string): Skeleton | undefined {
  const table: Record<Layouts[F], Skeleton> = SKELETONS[family];
  if (!Object.hasOwn(table, layout)) return undefined;
  return table[layout as Layouts[F]];
}

/** 1 枚のページ HTML を組み立てる。配置の型が骨組みの種類に合わなければ CliExit(1) */
export function renderSkeleton(request: SkeletonRequest): string {
  const skeleton = pickSkeleton(request.family, request.layout);
  if (skeleton === undefined) {
    throw new CliExit(EXIT_INPUT, {
      error: "input",
      message: `不明な配置の型です: ${request.family} / ${request.layout}`,
    });
  }
  const body = skeleton({ copy: request.copy, mode: request.mode });
  const extraStyles = surfaceStylesOf(request.surfaceCss);
  return pageHtml({
    title: request.title,
    themeId: request.themeId,
    mode: request.mode,
    cssForPage: request.cssForPage,
    fontsUrl: request.fontsUrl,
    body,
    ...(extraStyles === undefined ? {} : { extraStyles }),
  });
}

// 面の CSS を、テーマの style のあとに重ねる層にする。空・省略なら層を足さない
function surfaceStylesOf(css: string | undefined): { id: string; css: string }[] | undefined {
  return css === undefined || css === "" ? undefined : [{ id: "surface", css }];
}
