// 見本帳のスタイル 6 種を返す
import { usage } from "../../core/cli-exit.ts";
import { loadStyles } from "../../core/styles.ts";

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  void env;
  if (args.length > 0) throw usage(`styles に引数はありません: ${args.join(" ")}`);
  return Promise.resolve({ styles: loadStyles() });
}
