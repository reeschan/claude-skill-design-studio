// design-studio の CLI の入口。第 1 引数のサブコマンドを scripts/commands/<名前>.ts の run に渡す
// 標準出力には JSON を 1 つだけ出す。エラーは標準エラーに {"error": ...} を 1 行で出す
// 終了コード: 0 成功、1 入力エラー、2 利用者の対応が必要、3 外部の失敗
import { CliExit, EXIT_INPUT, EXIT_OK, usage } from "../core/cli-exit.ts";
import * as add from "./commands/add.ts";
import * as catalog from "./commands/catalog.ts";
import * as checkPage from "./commands/check-page.ts";
import * as install from "./commands/install.ts";
import * as mix from "./commands/mix.ts";
import * as project from "./commands/project.ts";
import * as renderDirection from "./commands/render-direction.ts";
import * as styles from "./commands/styles.ts";
import * as theme from "./commands/theme.ts";

type Command = (args: string[], env: NodeJS.ProcessEnv) => Promise<unknown>;

// 名前から実装を引く表。文字列の組み立てで動的に読み込まない
const COMMANDS: Record<string, Command> = {
  catalog: catalog.run,
  install: install.run,
  add: add.run,
  styles: styles.run,
  theme: theme.run,
  "render-direction": renderDirection.run,
  mix: mix.run,
  "check-page": checkPage.run,
  project: project.run,
};

const COMMAND_LIST = Object.keys(COMMANDS).join(" / ");

// 例外の message。無ければ文字列にする
function messageOf(e: unknown): unknown {
  const message = typeof e === "object" && e !== null && "message" in e ? e.message : undefined;
  return message ?? String(e);
}

// 例外を標準エラーに書き、終了コードを返す
function reportError(e: unknown): number {
  if (e instanceof CliExit) {
    process.stderr.write(JSON.stringify(e.payload) + "\n");
    return e.code;
  }
  process.stderr.write(JSON.stringify({ error: "internal", message: messageOf(e) }) + "\n");
  return EXIT_INPUT;
}

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    const [name, ...args] = argv;
    if (name === undefined) throw usage(`サブコマンドを 1 つ指定してください (${COMMAND_LIST})`);
    const command = COMMANDS[name];
    if (command === undefined) throw usage(`不明なサブコマンド: ${name}`);
    const result = await command(args, env);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return EXIT_OK;
  } catch (e) {
    return reportError(e);
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
