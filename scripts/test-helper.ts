// テストの助け。CLI を子プロセスとして起動し、利用者側の置き場を一時ディレクトリに向ける
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
  json: unknown; // 標準出力の JSON。無ければ標準エラーの JSON
};

// 空文字や壊れた JSON は null にする
function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** scripts/studio.ts をリポジトリのルートで実行し、終了コードと出力を返す */
export function runCli(args: string[], env: NodeJS.ProcessEnv): CliResult {
  const res = spawnSync(process.execPath, ["scripts/studio.ts", ...args], { cwd: REPO_ROOT, env, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { code: res.status ?? -1, stdout, stderr, json: parseJson(stdout) ?? parseJson(stderr) };
}

export type TempEnv = {
  dir: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
};

/** 一時ディレクトリを作り、置き場をそこに向けた env と後片付けを返す */
export function tempEnv(): TempEnv {
  const dir = mkdtempSync(join(tmpdir(), "design-studio-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESIGN_STUDIO_HOME: join(dir, "home"),
    DESIGN_STUDIO_SKILLS_DIR: join(dir, "skills"),
    DESIGN_STUDIO_PLUGINS_DIR: join(dir, "plugins"),
  };
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true });
  return { dir, env, cleanup };
}
