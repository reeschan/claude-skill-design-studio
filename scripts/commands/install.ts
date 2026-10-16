// 足りない傘下スキルを入れる。--plan で何をどこへ置くかを返し、--apply で実際に置く
import { usage } from "../../core/cli-exit.ts";
import { applyInstall, planInstall } from "../../core/installer.ts";

type Parsed = { kind: "plan"; ids: string[] | undefined } | { kind: "apply"; ids: string[] };

// --flag の直後の値を読む
function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined) throw usage(`${flag} には値が必要です`);
  return value;
}

// --ids a,b を配列にする
function parseIds(value: string): string[] {
  return value.split(",");
}

type RawArgs = { plan: boolean; apply: boolean; ids: string[] | undefined };

function readFlags(args: string[]): RawArgs {
  const raw: RawArgs = { plan: false, apply: false, ids: undefined };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) throw usage("引数を読めませんでした");
    if (arg === "--plan") raw.plan = true;
    else if (arg === "--apply") raw.apply = true;
    else if (arg === "--ids") {
      raw.ids = parseIds(nextValue(args, i, arg));
      i += 1;
    } else throw usage(`不明な引数です: ${arg}`);
  }
  return raw;
}

function parseArgs(args: string[]): Parsed {
  const raw = readFlags(args);
  if (raw.plan && raw.apply) throw usage("--plan と --apply は同時に使えません");
  if (raw.plan) return { kind: "plan", ids: raw.ids };
  if (!raw.apply) throw usage("--plan か --apply を指定してください");
  if (raw.ids === undefined) throw usage("--apply には --ids が必要です");
  return { kind: "apply", ids: raw.ids };
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const parsed = parseArgs(args);
  if (parsed.kind === "plan") return Promise.resolve({ plan: planInstall(env, parsed.ids) });
  return applyInstall(env, parsed.ids);
}
