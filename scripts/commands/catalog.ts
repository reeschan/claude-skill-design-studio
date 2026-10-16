// 台帳を返し、使う/使わないを切り替える。絞り込みは --stage
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { listCatalog, setEnabled } from "../../core/catalog.ts";
import { STAGES } from "../../core/types.ts";
import type { CatalogView, Stage } from "../../core/types.ts";

type RawArgs = { setId: string | undefined; enabled: string | undefined; stage: string | undefined };
type Parsed = { kind: "list"; stage: Stage | undefined } | { kind: "set"; id: string; enabled: boolean };

// --flag の直後の値を読む
function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined) throw usage(`${flag} には値が必要です`);
  return value;
}

function parseEnabled(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw usage("--enabled は true か false で指定してください");
}

function parseStage(value: string): Stage {
  const stage = STAGES.find((candidate) => candidate === value);
  if (stage === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な段階です: ${value}`, stages: STAGES });
  return stage;
}

function readFlags(args: string[]): RawArgs {
  const raw: RawArgs = { setId: undefined, enabled: undefined, stage: undefined };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) throw usage("引数を読めませんでした");
    if (arg === "--set") {
      raw.setId = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--enabled") {
      raw.enabled = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--stage") {
      raw.stage = nextValue(args, i, arg);
      i += 1;
    } else {
      throw usage(`不明な引数です: ${arg}`);
    }
  }
  return raw;
}

function listArgs(raw: RawArgs): Parsed {
  if (raw.enabled !== undefined) throw usage("--enabled は --set と一緒に使ってください");
  return { kind: "list", stage: raw.stage === undefined ? undefined : parseStage(raw.stage) };
}

function setArgs(id: string, raw: RawArgs): Parsed {
  if (raw.enabled === undefined) throw usage("--set には --enabled true|false が必要です");
  if (raw.stage !== undefined) throw usage("--set と --stage は同時に使えません");
  return { kind: "set", id, enabled: parseEnabled(raw.enabled) };
}

function parseArgs(args: string[]): Parsed {
  const raw = readFlags(args);
  return raw.setId === undefined ? listArgs(raw) : setArgs(raw.setId, raw);
}

function listResult(stage: Stage | undefined, env: NodeJS.ProcessEnv): { entries: CatalogView[] } {
  const entries = listCatalog(env).filter((entry) => stage === undefined || entry.stage === stage);
  return { entries };
}

function setResult(id: string, enabled: boolean, env: NodeJS.ProcessEnv): { entry: CatalogView } {
  const entry = listCatalog(env).find((item) => item.id === id);
  if (entry === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `知らない id です: ${id}`, id });
  setEnabled(env, id, enabled);
  return { entry: { ...entry, enabled } };
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const parsed = parseArgs(args);
  return Promise.resolve(parsed.kind === "list" ? listResult(parsed.stage, env) : setResult(parsed.id, parsed.enabled, env));
}
