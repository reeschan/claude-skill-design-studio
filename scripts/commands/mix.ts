// 方向性の案を軸ごとに混ぜる。中身は core/direction.ts が持つ
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { mixDirections, validatePicks } from "../../core/direction.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { validateDirection } from "../../core/styles.ts";
import type { Direction } from "../../core/types.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

type RawArgs = { directions: string | undefined; picks: string | undefined };
type MixArgs = { directions: string; picks: string };

// --directions <file> と --picks '<JSON>' を読む。知らない引数・値の欠けは usage
function readArgs(args: string[]): RawArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: { directions: { type: "string" }, picks: { type: "string" } },
    });
    return { directions: parsed.values.directions, picks: parsed.values.picks };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

function mixArgsOf(raw: RawArgs): MixArgs {
  const { directions, picks } = raw;
  if (directions === undefined || picks === undefined) {
    throw usage("mix は --directions <file> と --picks '<JSON>' を指定してください");
  }
  return { directions, picks };
}

// --directions のファイルを Direction の 1〜3 件の配列として読む
function readDirections(path: string): Direction[] {
  const raw = readJsonFile(path, "directions");
  if (!Array.isArray(raw)) throw inputError("--directions のファイルは Direction の配列で指定してください");
  if (raw.length < 1 || raw.length > 3) throw inputError(`--directions は 1〜3 件の配列で指定してください (${raw.length} 件)`);
  return raw.map((x) => validateDirection(x));
}

// --picks の JSON を読む。壊れていれば usage
function readPicks(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (e) {
    throw usage(`--picks は JSON で指定してください: ${errorMessage(e)}`);
  }
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  void env;
  const raw = mixArgsOf(readArgs(args));
  const directions = readDirections(raw.directions);
  const picks = validatePicks(readPicks(raw.picks), directions.length);
  return Promise.resolve({ direction: mixDirections(directions, picks) });
}
