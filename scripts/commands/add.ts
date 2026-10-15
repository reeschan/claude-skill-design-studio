// 追加台帳にスキルを足す。PBI-005 以降で中身を入れる
import { CliExit, EXIT_INPUT } from "../../core/cli-exit.ts";

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  void args;
  void env;
  throw new CliExit(EXIT_INPUT, { error: "not-implemented", command: "add" });
}
