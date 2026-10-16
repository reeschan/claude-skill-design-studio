// 方向性の案をパッドの点で混ぜ、微調整を重ねる。中身は core/direction.ts が持つ
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { applyFineTune, mixDirections, validateFineTune, validatePoints } from "../../core/direction.ts";
import { readJsonFile } from "../../core/json-file.ts";
import { validateDirection } from "../../core/styles.ts";
import type { Direction } from "../../core/types.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

type RawArgs = { directions: string | undefined; points: string | undefined; "fine-tune": string | undefined };
type MixArgs = { directions: string; points: string; "fine-tune": string | undefined };

// --directions <file> と --points '<JSON>' (と任意の --fine-tune '<JSON>') を読む。知らない引数・値の欠けは usage
function readArgs(args: string[]): RawArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: { directions: { type: "string" }, points: { type: "string" }, "fine-tune": { type: "string" } },
    });
    return { directions: parsed.values.directions, points: parsed.values.points, "fine-tune": parsed.values["fine-tune"] };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

function mixArgsOf(raw: RawArgs): MixArgs {
  const { directions, points, "fine-tune": fineTune } = raw;
  if (directions === undefined || points === undefined) {
    throw usage("mix は --directions <file> と --points '<JSON>' を指定してください");
  }
  return { directions, points, "fine-tune": fineTune };
}

// --directions のファイルを Direction の 1〜4 件の配列として読む
function readDirections(path: string): Direction[] {
  const raw = readJsonFile(path, "directions");
  if (!Array.isArray(raw)) throw inputError("--directions のファイルは Direction の配列で指定してください");
  if (raw.length < 1 || raw.length > 4) throw inputError(`--directions は 1〜4 件の配列で指定してください (${String(raw.length)} 件)`);
  return raw.map((x) => validateDirection(x));
}

// --points / --fine-tune の JSON を読む。壊れていれば usage
function readJsonArg(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (e) {
    throw usage(`--${label} は JSON で指定してください: ${errorMessage(e)}`);
  }
}

export function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  void env;
  const raw = mixArgsOf(readArgs(args));
  const directions = readDirections(raw.directions);
  const mixed = mixDirections(directions, validatePoints(readJsonArg(raw.points, "points")));
  const direction =
    raw["fine-tune"] === undefined
      ? mixed.direction
      : applyFineTune(mixed.direction, validateFineTune(readJsonArg(raw["fine-tune"], "fine-tune")));
  return Promise.resolve({ mixed: mixed.direction, direction, weights: mixed.weights, snapped: mixed.snapped });
}
