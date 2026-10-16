// テスト用の偽 style-guide。`render --seed <file>` に決まった JSON を返す。
// 環境変数 FAKE_SG_MODE が "outdated" なら古い style-guide と同じエラー、"fail" なら別のエラーで止まる
import { readFileSync } from "node:fs";

const EXIT_OK = 0;
const EXIT_INPUT = 1;

class FakeExit extends Error {
  code: number;
  payload: Record<string, unknown>;
  constructor(code: number, payload: Record<string, unknown>) {
    super(String(payload.error));
    this.name = "FakeExit";
    this.code = code;
    this.payload = payload;
  }
}

const usage = (message: string): FakeExit => new FakeExit(EXIT_INPUT, { error: "usage", message });

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// オブジェクトからキーを読む。オブジェクトでなければ null
const field = (o: unknown, key: string): unknown => (isRecord(o) ? o[key] : null);

// 引数から --seed のファイルのパスを読む
function seedPath(argv: string[]): string {
  const [command, ...rest] = argv;
  if (command !== "render") throw usage(`不明なサブコマンド: ${command}`);
  const index = rest.indexOf("--seed");
  const path = index === -1 ? undefined : rest[index + 1];
  if (path === undefined) throw usage("--seed <file> が必要です");
  return path;
}

// Seed 1 つ、または Seed の配列の JSON を読む
function readSeeds(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new FakeExit(EXIT_INPUT, { error: "file", path, message: errorMessage(e) });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new FakeExit(EXIT_INPUT, { error: "input", message: `JSON として読めません: ${errorMessage(e)}` });
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

// 偽の応答。failed は 0 以外にして、値がそのまま通ることをテストで確かめられるようにする
function fakeResponse(seeds: unknown[]): unknown {
  return {
    dir: null,
    css: '@import "tailwindcss";\n:root { --fake-radius: 4px; }\n',
    themes: seeds.map((seed) => ({ id: field(seed, "id"), name: field(seed, "name") })),
    summary: seeds.map((seed) => ({
      id: field(seed, "id"),
      name: field(seed, "name"),
      fontsUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap",
      checks: { light: { pass: 4, total: 5, adjusted: 1 }, dark: { pass: 3, total: 5, adjusted: 0 } },
    })),
    failed: 2,
  };
}

// render を持たない古い style-guide は、サブコマンドを振り分ける前の parseArgs({strict: true}) で
// 止まる。本物 (9d24a8a) が返す文面と終了コード 1 をそのまま写す
const OUTDATED_MESSAGE =
  "Unknown option '--seed'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--seed\"'";

function main(argv: string[]): unknown {
  const mode = process.env.FAKE_SG_MODE;
  if (mode === "outdated") throw usage(OUTDATED_MESSAGE);
  if (mode === "fail") throw new FakeExit(EXIT_INPUT, { error: "input", message: "種の検証に失敗しました (偽)" });
  return fakeResponse(readSeeds(seedPath(argv)));
}

function reportError(e: unknown): number {
  if (e instanceof FakeExit) {
    process.stderr.write(JSON.stringify(e.payload) + "\n");
    return e.code;
  }
  process.stderr.write(JSON.stringify({ error: "internal", message: errorMessage(e) }) + "\n");
  return EXIT_INPUT;
}

function run(argv: string[]): number {
  try {
    process.stdout.write(JSON.stringify(main(argv), null, 2) + "\n");
    return EXIT_OK;
  } catch (e) {
    return reportError(e);
  }
}

process.exitCode = run(process.argv.slice(2));
