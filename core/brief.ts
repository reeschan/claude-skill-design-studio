// 依頼 (作業台のフォームに書く、作りたいものと条件) の検証。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import type { Brief } from "./types.ts";

const WHAT_MAX = 2000;
const FIELD_MAX = 500;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 依頼を検証する。what は必須、ほかは無ければ空文字。前後の空白は落とす */
export function validateBrief(x: unknown): Brief {
  if (!isRecord(x)) throw inputError("brief はオブジェクトで指定してください");
  return {
    what: whatOf(x.what),
    mood: optionalText(x.mood, "brief.mood"),
    audience: optionalText(x.audience, "brief.audience"),
    mustHave: optionalText(x.mustHave, "brief.mustHave"),
  };
}

// 作りたいもの。無い・空白だけのときの文言は取り決め (contract.md の 3 節)
function whatOf(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError("作りたいもの (brief.what) を書いてください");
  const what = value.trim();
  if (what.length > WHAT_MAX) throw inputError(`brief.what は trim 後 1〜${WHAT_MAX} 文字で指定してください`);
  return what;
}

// 任意の項目。無ければ空文字、文字列なら trim したもの
function optionalText(value: unknown, label: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw inputError(`${label} は文字列で指定してください`);
  const text = value.trim();
  if (text.length > FIELD_MAX) throw inputError(`${label} は trim 後 0〜${FIELD_MAX} 文字で指定してください`);
  return text;
}
