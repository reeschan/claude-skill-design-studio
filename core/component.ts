// 部品 (部品帳に並ぶ候補と、自由な名前の部品) の検証と、保存のキー。
// 外部入力の検証は core/page-type.ts に倣って手で書く
import { createHash } from "node:crypto";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";
import type { ComponentCandidate, ComponentTarget } from "./types.ts";

// 部品帳 (プロジェクトに 1 件) の保存のキーと名前
export const COMPONENT_SHEET_KEY = "component-sheet";
export const COMPONENT_SHEET_NAME = "部品帳";

const NAME_MAX = 40;
// 自由な名前のキーの、ハッシュを付ける前の見出し部分の長さ
const SLUG_MAX = 24;
// ハッシュの桁数 ("-" と合わせて 9 文字)
const DIGEST_LENGTH = 8;
// 名前に含められない文字。制御文字 (U+0000〜U+001F・U+007F) と、タグの記号 < >
const FORBIDDEN_NAME_RE = /[\u0000-\u001f\u007f<>]/;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 候補の名前と完全一致 (trim 後) する候補。無ければ undefined */
export function componentCandidateOf(name: string): ComponentCandidate | undefined {
  const trimmed = name.trim();
  return COMPONENT_CANDIDATES.find((candidate) => candidate.name === trimmed);
}

/**
 * 外部入力の部品の名前を検証する。文字列で、trim 後 1〜40 文字。
 * 制御文字と < > は使えない。返すのは trim 後の値
 */
export function validateComponentName(x: unknown): string {
  if (typeof x !== "string") throw inputError("部品の名前は文字列で指定してください");
  const name = x.trim();
  if (name.length < 1 || name.length > NAME_MAX) throw inputError(`部品の名前は trim 後 1〜${NAME_MAX} 文字で指定してください`);
  if (FORBIDDEN_NAME_RE.test(name)) throw inputError("部品の名前には制御文字と < > を使えません");
  return name;
}

// 使ってよいキーだけを持つか (余分な項目は入力の誤り)
function ensureOnlyKeys(x: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(x)) {
    if (!allowed.includes(key)) throw inputError(`${label} に使えない項目 ${key} があります`);
  }
}

/** 外部入力の作るもの (部品の側) を検証する。{kind:"component-sheet"} か {kind:"component", name} */
export function validateComponentTarget(x: unknown): ComponentTarget {
  if (!isRecord(x)) throw inputError("作るもの (部品) はオブジェクトで指定してください");
  if (x.kind === "component-sheet") {
    ensureOnlyKeys(x, ["kind"], "作るもの (部品帳)");
    return { kind: "component-sheet" };
  }
  if (x.kind === "component") {
    ensureOnlyKeys(x, ["kind", "name"], "作るもの (部品)");
    return { kind: "component", name: validateComponentName(x.name) };
  }
  throw inputError('作るものの kind は "component-sheet" / "component" のいずれかで指定してください');
}

/**
 * 部品の保存のキー。候補の名前なら候補の id。
 * それ以外は名前から作る (名前だけから決まるので、作り直しても変わらない)。
 * 名前は先に trim と NFKC をしてから、候補の判定・見出し・ハッシュに使う
 */
export function componentKeyOf(name: string): string {
  const normalized = name.trim().normalize("NFKC");
  const candidate = componentCandidateOf(normalized);
  if (candidate !== undefined) return candidate.id;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, DIGEST_LENGTH);
  return `${slugOf(normalized)}-${digest}`;
}

// 名前の見出し部分。英小文字と数字の連続だけを残し、24 文字で切る (空なら component)
function slugOf(normalized: string): string {
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
  return slug === "" ? "component" : slug;
}

/** 部品の側の作るものの保存のキーと名前 (部品帳は固定、部品は名前ごと) */
export function componentItemIdentity(target: ComponentTarget): { key: string; name: string } {
  if (target.kind === "component-sheet") return { key: COMPONENT_SHEET_KEY, name: COMPONENT_SHEET_NAME };
  return { key: componentKeyOf(target.name), name: target.name };
}
