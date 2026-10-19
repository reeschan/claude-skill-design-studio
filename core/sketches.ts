// 同梱の見本のスケッチ (data/sketches.json) と、自前の関数・定数の一覧 (data/sketch-api.json) を読む。
// データのディレクトリの引き方と検証の流儀は core/treatment.ts の loadSurfaces / loadMotions にそろえる
import { fileURLToPath } from "node:url";
import { SKETCH_CODE_MAX } from "./background.ts";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { readJsonFile } from "./json-file.ts";
import type { SketchSample } from "./types.ts";

// core/sketches.ts の 1 つ上 = リポジトリのルート
const SKETCHES_FILE = fileURLToPath(new URL("../data/sketches.json", import.meta.url));
const SKETCH_API_FILE = fileURLToPath(new URL("../data/sketch-api.json", import.meta.url));

const SKETCH_ID_RE = /^[a-z][a-z0-9-]*$/;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 空でない文字列
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

// 空でない文字列の配列 (空の配列は許す)
function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw inputError(`${label} は文字列の配列で指定してください`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

// id の形 (英小文字で始まる英小文字・数字・ハイフン)
function idOf(value: unknown, label: string): string {
  const id = text(value, label);
  if (!SKETCH_ID_RE.test(id)) throw inputError(`${label} は /^[a-z][a-z0-9-]*$/ に合う文字列で指定してください`);
  return id;
}

// code は 1〜SKETCH_CODE_MAX 文字
function codeOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > SKETCH_CODE_MAX) {
    throw inputError(`${label} は 1〜${SKETCH_CODE_MAX} 文字で指定してください`);
  }
  return value;
}

// 見本の 1 件
function sketchOf(value: unknown, index: number): SketchSample {
  if (!isRecord(value)) throw inputError(`sketches[${index}] はオブジェクトで指定してください`);
  const label = `sketches[${index}]`;
  return {
    id: idOf(value.id, `${label}.id`),
    name: text(value.name, `${label}.name`),
    description: text(value.description, `${label}.description`),
    code: codeOf(value.code, `${label}.code`),
  };
}

// id の重複を止める
function ensureUniqueIds(entries: readonly { id: string }[]): void {
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw inputError("data/sketches.json の id が重複しています");
  }
}

/** data/sketches.json を読み、検証して返す。呼ぶたびに新しい配列とオブジェクトを返す */
export function loadSketchSamples(): SketchSample[] {
  const raw = readJsonFile(SKETCHES_FILE, "sketches");
  if (!isRecord(raw) || !Array.isArray(raw.sketches)) {
    throw inputError("data/sketches.json は { sketches: [...] } で指定してください");
  }
  const sketches = raw.sketches.map((entry, index) => sketchOf(entry, index));
  ensureUniqueIds(sketches);
  return sketches;
}

/** data/sketch-api.json を読み、自前の関数と定数の一覧を返す */
export function loadSketchApi(): { functions: string[]; constants: string[] } {
  const raw = readJsonFile(SKETCH_API_FILE, "sketch-api");
  if (!isRecord(raw) || !Array.isArray(raw.functions) || !Array.isArray(raw.constants)) {
    throw inputError("data/sketch-api.json は { functions: [...], constants: [...] } で指定してください");
  }
  return { functions: textList(raw.functions, "functions"), constants: textList(raw.constants, "constants") };
}
