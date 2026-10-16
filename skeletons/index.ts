// 画面の種類 × 配置の型から骨組みを引く表と、1 枚のページ HTML に組み立てる renderSkeleton
import { CliExit, EXIT_INPUT } from "../core/cli-exit.ts";
import { pageHtml } from "../core/page-html.ts";
import type { BaseMode, Copy, Layouts, PageType } from "../core/types.ts";
import * as blog from "./blog.ts";
import * as dashboard from "./dashboard.ts";
import * as lp from "./lp.ts";
import type { Skeleton } from "./types.ts";

export const SKELETONS: { [P in PageType]: Record<Layouts[P], Skeleton> } = {
  lp: { centered: lp.centered, split: lp.split, fullbleed: lp.fullbleed },
  dashboard: { sidebar: dashboard.sidebar, topnav: dashboard.topnav, cards: dashboard.cards },
  blog: { classic: blog.classic, magazine: blog.magazine, minimal: blog.minimal },
};

export type SkeletonRequest = {
  pageType: PageType;
  layout: string; // LAYOUTS[pageType] のいずれか。外れていれば CliExit(1)
  copy: Copy;
  mode: BaseMode;
  themeId: string;
  cssForPage: string;
  fontsUrl: string;
  title: string;
};

function pickSkeleton<P extends PageType>(pageType: P, layout: string): Skeleton | undefined {
  const table: Record<Layouts[P], Skeleton> = SKELETONS[pageType];
  if (!Object.hasOwn(table, layout)) return undefined;
  return table[layout as Layouts[P]];
}

/** 1 枚のページ HTML を組み立てる。配置の型が画面の種類に合わなければ CliExit(1) */
export function renderSkeleton(request: SkeletonRequest): string {
  const skeleton = pickSkeleton(request.pageType, request.layout);
  if (skeleton === undefined) {
    throw new CliExit(EXIT_INPUT, {
      error: "input",
      message: `不明な配置の型です: ${request.pageType} / ${request.layout}`,
    });
  }
  const body = skeleton({ copy: request.copy, mode: request.mode });
  return pageHtml({
    title: request.title,
    themeId: request.themeId,
    mode: request.mode,
    cssForPage: request.cssForPage,
    fontsUrl: request.fontsUrl,
    body,
  });
}
