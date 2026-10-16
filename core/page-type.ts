// 画面の種類 (利用者に見せる名前と、当てた骨組みの種類の組) の検証と、ページの保存のキー。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { createHash } from "node:crypto";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "./types.ts";
import type { PageType, SkeletonFamily } from "./types.ts";

const NAME_MAX = 40;
// 自由な名前のキーの、ハッシュを付ける前の見出し部分の長さ
const SLUG_MAX = 24;
// ハッシュの桁数 ("-" と合わせて 9 文字)
const DIGEST_LENGTH = 8;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 画面の種類を検証する。name は trim 後 1〜40 文字。family は任意で、あれば骨組みの種類のどれか */
export function validatePageType(x: unknown): { name: string; family?: SkeletonFamily } {
  if (!isRecord(x)) throw inputError("pageType は {name, family?} のオブジェクトで指定してください");
  if (typeof x.name !== "string") throw inputError("pageType.name は文字列で指定してください");
  const name = x.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) throw inputError(`pageType.name は trim 後 1〜${NAME_MAX} 文字で指定してください`);
  if (x.family === undefined) return { name };
  return { name, family: familyOf(x.family) };
}

// 骨組みの種類のいずれか
function familyOf(value: unknown): SkeletonFamily {
  if (typeof value === "string") {
    const found = SKELETON_FAMILIES.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`pageType.family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
}

/** 候補の名前と完全一致 (trim 後) する画面の種類。無ければ undefined */
export function candidateOf(name: string): PageType | undefined {
  const trimmed = name.trim();
  return PAGE_TYPE_CANDIDATES.find((candidate) => candidate.name === trimmed);
}

/**
 * ページの保存のキー。候補の名前ならその family。
 * それ以外は名前から作る (名前だけから決まるので、骨組みの種類を選び直しても変わらない)。
 * 名前は先に trim と NFKC をしてから、候補の判定・見出し・ハッシュに使う
 */
export function pageKeyOf(pageType: PageType): string {
  const name = pageType.name.trim().normalize("NFKC");
  const candidate = candidateOf(name);
  if (candidate !== undefined) return candidate.family;
  const digest = createHash("sha256").update(name).digest("hex").slice(0, DIGEST_LENGTH);
  return `${slugOf(name)}-${digest}`;
}

// 名前の見出し部分。英小文字と数字の連続だけを残し、24 文字で切る (空なら page)
function slugOf(normalized: string): string {
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
  return slug === "" ? "page" : slug;
}
