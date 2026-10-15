// 環境変数から各パスを決める。各モジュールは環境変数を直接読まず、ここの関数を通す
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REGISTRY_URL = "https://www.ui-skills.com/skills/registry.txt";
const DEFAULT_GITHUB_BASE = "https://github.com";

// core/paths.ts の 1 つ上 = リポジトリのルート
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// 未設定 (undefined・空文字) は既定にまわす
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 先頭の `~` を os.homedir() に置き換える */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/** 利用者側の状態の置き場。既定 ~/.claude/design-studio */
export function studioHome(env: NodeJS.ProcessEnv): string {
  const value = envValue(env, "DESIGN_STUDIO_HOME");
  return value === undefined ? join(homedir(), ".claude", "design-studio") : expandHome(value);
}

/** スキルの置き場。既定 ~/.claude/skills */
export function skillsDir(env: NodeJS.ProcessEnv): string {
  const value = envValue(env, "DESIGN_STUDIO_SKILLS_DIR");
  return value === undefined ? join(homedir(), ".claude", "skills") : expandHome(value);
}

/** プラグインの置き場。既定 ~/.claude/plugins */
export function pluginsDir(env: NodeJS.ProcessEnv): string {
  const value = envValue(env, "DESIGN_STUDIO_PLUGINS_DIR");
  return value === undefined ? join(homedir(), ".claude", "plugins") : expandHome(value);
}

/** style-guide の場所。既定 <skillsDir>/style-guide */
export function styleGuideDir(env: NodeJS.ProcessEnv): string {
  const value = envValue(env, "STYLE_GUIDE_DIR");
  return value === undefined ? join(skillsDir(env), "style-guide") : expandHome(value);
}

/** ui-skills.com の索引。ファイルのパスも受け付ける */
export function registryUrl(env: NodeJS.ProcessEnv): string {
  return envValue(env, "DESIGN_STUDIO_REGISTRY_URL") ?? DEFAULT_REGISTRY_URL;
}

/** git の実行ファイル */
export function gitCommand(env: NodeJS.ProcessEnv): string {
  return envValue(env, "DESIGN_STUDIO_GIT") ?? "git";
}

/** claude CLI の代わりに使うコマンド。未設定なら null (本物の claude を使う) */
export function llmCommand(env: NodeJS.ProcessEnv): string | null {
  return envValue(env, "DESIGN_STUDIO_LLM_CMD") ?? null;
}

/** GitHub の取得元の土台。テストではローカルのディレクトリを指す */
export function githubBase(env: NodeJS.ProcessEnv): string {
  return envValue(env, "DESIGN_STUDIO_GITHUB_BASE") ?? DEFAULT_GITHUB_BASE;
}

/** 見本ページの置き場。既定はリポジトリの gallery/ */
export function galleryDir(env: NodeJS.ProcessEnv): string {
  const value = envValue(env, "DESIGN_STUDIO_GALLERY_DIR");
  return value === undefined ? join(REPO_ROOT, "gallery") : expandHome(value);
}
