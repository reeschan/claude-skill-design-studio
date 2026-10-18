// デザインガイドのファイル一式を組み立てる。style-guide の文書の口 (renderThemeWithDoc) を呼ぶ。
// 取り決めは docs/pbi/notes/contract.md の 3 節
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { STYLE_GUIDE_UPDATE_NOTICE, designGuideMarkdown, validateDesignGuideFiles } from "./design-guide.ts";
import type { DesignGuideFile, DesignGuideValues } from "./design-guide.ts";
import { hasPageCsp } from "./page-html.ts";
import { renderThemeWithDoc } from "./theme-bridge.ts";
import type { Direction, Treatment } from "./types.ts";

export type BuildDesignGuideInput = {
  direction: Direction;
  treatment: Treatment;
  sheetHtml: string;
  values: DesignGuideValues;
};
export type DesignGuideBuild = { styleGuide: "ok" | "outdated"; notice: string | null; files: DesignGuideFile[] };

// 部品帳とテーマの 3 ファイル。design-guide.md と style-guide.md は style-guide が文書を返したときだけ足す
function themeFilesOf(input: BuildDesignGuideInput, css: string, themes: unknown[]): DesignGuideFile[] {
  return [
    { name: "component-sheet.html", content: input.sheetHtml },
    { name: "theme.css", content: css },
    { name: "theme.json", content: JSON.stringify(themes, null, 2) + "\n" },
  ];
}

function filesOf(input: BuildDesignGuideInput, css: string, themes: unknown[], styleGuideMd: string | null): DesignGuideFile[] {
  const themeFiles = themeFilesOf(input, css, themes);
  if (styleGuideMd === null) return themeFiles;
  const documentFiles: DesignGuideFile[] = [
    {
      name: "design-guide.md",
      content: designGuideMarkdown({ directionName: input.direction.name, treatment: input.treatment, values: input.values }),
    },
    { name: "style-guide.md", content: styleGuideMd },
  ];
  return [...documentFiles, ...themeFiles];
}

/** デザインガイドのファイル一式を作る (書かない)。style-guide の文書の口 (renderThemeWithDoc) を呼ぶ */
export async function buildDesignGuide(input: BuildDesignGuideInput, env: NodeJS.ProcessEnv): Promise<DesignGuideBuild> {
  // 入力の誤りを先に返す (style-guide が古い・無いときに終了コード 2 が先に出ないように)。文面は validateDesignGuideFiles と同じ
  if (!hasPageCsp(input.sheetHtml)) {
    throw new CliExit(EXIT_INPUT, {
      error: "input",
      message: "files の component-sheet.html は CSP の meta (PAGE_CSP) を持つ HTML にしてください",
    });
  }
  const { theme, styleGuideMd } = await renderThemeWithDoc(input.direction.seed, env);
  const files = validateDesignGuideFiles(filesOf(input, theme.css, theme.themes, styleGuideMd));
  if (styleGuideMd === null) return { styleGuide: "outdated", notice: STYLE_GUIDE_UPDATE_NOTICE, files };
  return { styleGuide: "ok", notice: null, files };
}
