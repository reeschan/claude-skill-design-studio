// 作ったページを点検する。許可していない外部の読み込みと、テーマの style の有無を見る
import { readFileSync } from "node:fs";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { THEME_STYLE_TAG, findDisallowedUrls } from "../../core/page-html.ts";

const THEME_ID_RE = /<html[^>]*\bdata-theme="([^"]*)"/i;

// --html <file> のファイルのパスを取り出す
function parseArgs(args: string[]): string {
  const index = args.indexOf("--html");
  const path = index === -1 ? undefined : args[index + 1];
  if (path === undefined) throw usage("check-page は --html <file> を指定してください");
  return path;
}

function readHtml(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CliExit(EXIT_INPUT, { error: "file", file: "html", path, message });
  }
}

function themeIdOf(html: string): string | null {
  const match = THEME_ID_RE.exec(html);
  return match?.[1] ?? null;
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  void env;
  const path = parseArgs(args);
  const html = readHtml(path);
  const disallowed = findDisallowedUrls(html);
  const hasThemeStyle = html.includes(THEME_STYLE_TAG);
  const result = { ok: disallowed.length === 0 && hasThemeStyle, disallowed, hasThemeStyle, themeId: themeIdOf(html) };
  return Promise.resolve(result);
}
