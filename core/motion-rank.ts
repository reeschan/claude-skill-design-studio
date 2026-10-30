// 別名の一致で候補を狭め、キーがあるときだけ Jev に当てはまりを採点させて並べ直す。
// キーが無い・Jev が失敗したときは別名の順のまま返す。
import { callJev, jevApiKey, JEV_MODEL, JevError } from "./jev.ts";
import type { JevQuestion } from "./jev.ts";
import { loadMotionDictionary } from "./motion-dictionary.ts";
import { normMotionText } from "./motion-match.ts";
import { loadMotions } from "./treatment.ts";

export type MotionRankHit = { id: string; name: string; score: number; hit: string };

export type MotionRank = { source: "alias" | "jev"; results: MotionRankHit[]; note?: string };

const SEARCH_LIMIT = 8;
const SEARCH_MIN = 2.5;
const SCORE_CRITERIA = ["まったく関係がない", "少し関係がある", "かなり当てはまる", "この言い方そのもの"] as const;

type CatalogItem = { id: string; name: string; aliases: string[]; scene: string };

function grams(value: string): Set<string> {
  const found = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) found.add(value.slice(index, index + 2));
  return found;
}

function gramScore(query: string, alias: string): number {
  const left = grams(query);
  const right = grams(alias);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  if (shared === 0) return 0;
  return (shared / Math.max(2, Math.min(left.size, right.size))) * 6;
}

function scoreAlias(query: string, alias: string): number {
  const nq = normMotionText(query);
  const na = normMotionText(alias);
  if (nq === "" || na === "") return 0;
  if (nq.includes(na)) return 10 + na.length;
  if (na.includes(nq) && nq.length >= 2) return 8 + nq.length;
  return gramScore(nq, na);
}

function sceneBoost(query: string, scene: string): number {
  return Math.min(2, gramScore(normMotionText(query), normMotionText(scene)) * 0.7);
}

export function scoreMotionItem(query: string, item: CatalogItem): MotionRankHit {
  let best = 0;
  let hit = item.name;
  for (const alias of [item.id, item.name, ...item.aliases]) {
    const score = scoreAlias(query, alias);
    if (score > best) {
      best = score;
      hit = alias;
    }
  }
  return { id: item.id, name: item.name, score: best + sceneBoost(query, item.scene), hit };
}

function rankItems(query: string, items: readonly CatalogItem[], min: number, limit: number): MotionRankHit[] {
  if (normMotionText(query) === "") return [];
  return items
    .map((item) => scoreMotionItem(query, item))
    .filter((hit) => hit.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function motionItems(): CatalogItem[] {
  return loadMotions().map((sample) => ({
    id: sample.id,
    name: sample.name,
    aliases: sample.aliases,
    scene: sample.scene ?? sample.description,
  }));
}

function effectItems(): CatalogItem[] {
  return loadMotionDictionary().effects.map((effect) => ({
    id: effect.id,
    name: effect.name,
    aliases: effect.aliases,
    scene: effect.scene,
  }));
}

/** 見本帳の検索。見本と辞書の効果を別名で並べ、上位だけ返す */
export function searchMotions(query: string): MotionRankHit[] {
  return rankItems(query, motionItems(), SEARCH_MIN, SEARCH_LIMIT);
}

/** 正規化で強い一致が無いときの候補。別名が言い方を含む、またはその逆だけ */
export function fuzzyEffects(query: string): MotionRankHit[] {
  return rankItems(query, effectItems(), 8, 4);
}

function mockMap(raw: string): Map<string, number> | "fail" {
  if (raw === "fail") return "fail";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "fail";
    const scores = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") scores.set(key, value);
    }
    return scores;
  } catch {
    return "fail";
  }
}

function questionsFor(query: string, hits: readonly MotionRankHit[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const hit of hits) {
    questions[hit.id] = {
      type: "score",
      instructions: `言い方「${query}」は、動き「${hit.name}」（一致した呼び名: ${hit.hit}）にどれだけ当てはまるか。`,
      criteria: SCORE_CRITERIA,
    };
  }
  return questions;
}

async function scoresFromJev(query: string, hits: readonly MotionRankHit[], env: NodeJS.ProcessEnv): Promise<Map<string, number> | "fail"> {
  const mock = env.DESIGN_STUDIO_JEV_MOCK;
  if (typeof mock === "string" && mock !== "") return mockMap(mock);
  if (jevApiKey(env) === null) return new Map();
  try {
    const response = await callJev({
      state: `利用者の言い方: ${query}`,
      questions: questionsFor(query, hits),
      model: JEV_MODEL,
      endpoint: env.DESIGN_STUDIO_JEV_URL,
      env,
      timeoutMs: 20000,
      maxRetries: 1,
    });
    const scores = new Map<string, number>();
    for (const hit of hits) {
      const score = response.answers[hit.id]?.score;
      if (typeof score === "number") scores.set(hit.id, score);
    }
    return scores;
  } catch (error) {
    if (error instanceof JevError) return "fail";
    return "fail";
  }
}

function reorder(hits: readonly MotionRankHit[], scores: Map<string, number>): MotionRankHit[] {
  return [...hits].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) || b.score - a.score);
}

const FALLBACK_NOTE = "Jev に聞けなかったので、別名の一致で並べました。";

/** 別名で狭めた候補を、Jev の採点があればそれで並べ直す */
export async function rankMotionSearch(query: string, env: NodeJS.ProcessEnv): Promise<MotionRank> {
  const results = searchMotions(query);
  if (results.length === 0) return { source: "alias", results };
  const scores = await scoresFromJev(query, results, env);
  if (scores === "fail") return { source: "alias", results, note: FALLBACK_NOTE };
  if (scores.size === 0) return { source: "alias", results };
  return { source: "jev", results: reorder(results, scores) };
}

/** 正規化の候補を Jev で並べる。キーが無いときは null (別名の順のまま) */
export async function jevEffectScores(
  query: string,
  ids: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Map<string, number> | "fail" | null> {
  if (ids.length < 2) return null;
  const hits = ids.map((id) =>
    scoreMotionItem(query, effectItems().find((item) => item.id === id) ?? { id, name: id, aliases: [], scene: "" }),
  );
  const scores = await scoresFromJev(query, hits, env);
  if (scores !== "fail" && scores.size === 0) return null;
  return scores;
}
