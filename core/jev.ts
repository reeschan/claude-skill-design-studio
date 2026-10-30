// Jev (TypeSafe) のクライアント。キーはサーバーと CLI だけが読む。ブラウザには渡さない。
// 呼び出し形は atelier の skills/atelier/jev/jev.mjs にそろえる。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";

export type JevCode = "no-key" | "http" | "network" | "timeout" | "bad-response";

export class JevError extends Error {
  code: JevCode;
  status: number;
  constructor(message: string, code: JevCode, status = 0) {
    super(message);
    this.name = "JevError";
    this.code = code;
    this.status = status;
  }
}

export type JevQuestion = {
  type: "score" | "choice" | "noul";
  instructions: string;
  criteria?: readonly string[] | Readonly<Record<string, string>>;
};

export type JevAnswer = { type?: string; score?: number; choice?: string; noul?: number; confidence?: number };

export type JevResponse = { model?: string; answers: Record<string, JevAnswer> };

type Sleep = (ms: number) => Promise<void>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function keyFromFile(path: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return null;
    const key = parsed.api_key;
    return typeof key === "string" && key !== "" ? key : null;
  } catch {
    return null;
  }
}

/** 1. 環境変数 TYPESAFE_API_KEY、2. ~/.config/typesafe/credentials.json の api_key。無ければ null */
export function jevApiKey(env: NodeJS.ProcessEnv): string | null {
  const fromEnv = env.TYPESAFE_API_KEY;
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  const path = env.TYPESAFE_CREDENTIALS_FILE || join(homedir(), ".config", "typesafe", "credentials.json");
  return keyFromFile(path);
}

function retryWaitMs(retryAfter: string | null, attempt: number): number {
  const parsed = retryAfter === null || retryAfter === "" ? Number.NaN : Number(retryAfter);
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 2 ** attempt;
  return Math.min(seconds, 30) * 1000;
}

function timeoutError(error: unknown): JevError {
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = name === "TimeoutError" || name === "AbortError";
  return new JevError(`${timedOut ? "タイムアウト" : "接続エラー"}: ${message}`, timedOut ? "timeout" : "network");
}

type Fetched = { status: number; text: string; retryAfter: string | null };

async function postJson(url: string, body: string, apiKey: string, timeoutMs: number): Promise<Fetched> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { status: response.status, text, retryAfter: response.headers.get("retry-after") };
}

function answersOf(text: string, status: number): JevResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JevError(`応答が JSON でない: ${text.slice(0, 500)}`, "bad-response", status);
  }
  if (!isRecord(parsed) || !isRecord(parsed.answers)) {
    throw new JevError(`応答に answers が無い: ${text.slice(0, 500)}`, "bad-response", status);
  }
  const answers: Record<string, JevAnswer> = {};
  for (const [key, value] of Object.entries(parsed.answers)) {
    answers[key] = isRecord(value) ? answerOf(value) : {};
  }
  return { model: typeof parsed.model === "string" ? parsed.model : undefined, answers };
}

function answerOf(value: Record<string, unknown>): JevAnswer {
  return {
    type: typeof value.type === "string" ? value.type : undefined,
    score: typeof value.score === "number" ? value.score : undefined,
    choice: typeof value.choice === "string" ? value.choice : undefined,
    noul: typeof value.noul === "number" ? value.noul : undefined,
    confidence: typeof value.confidence === "number" ? value.confidence : undefined,
  };
}

type Retry = "ok" | "rate" | "once" | "stop";

function retryOf(status: number, rateRetries: number, otherRetried: boolean, maxRetries: number): Retry {
  if (status >= 200 && status < 300) return "ok";
  if ((status === 429 || status === 529) && rateRetries < maxRetries) return "rate";
  if (status >= 500 && status <= 599 && !otherRetried) return "once";
  return "stop";
}

export type CallJevInput = {
  state: unknown;
  questions: Record<string, JevQuestion>;
  model?: string;
  endpoint?: string;
  apiKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: Sleep;
  env?: NodeJS.ProcessEnv;
};

async function send(url: string, body: string, apiKey: string, timeoutMs: number): Promise<Fetched | JevError> {
  try {
    return await postJson(url, body, apiKey, timeoutMs);
  } catch (error) {
    return timeoutError(error);
  }
}

function httpError(status: number, text: string): JevError {
  return new JevError(`HTTP ${status}: ${text.slice(0, 500)}`, "http", status);
}

/** Jev を呼んで answers を返す。キーが無い・失敗は JevError */
export async function callJev(input: CallJevInput): Promise<JevResponse> {
  const apiKey = input.apiKey === undefined ? jevApiKey(input.env ?? process.env) : input.apiKey;
  if (apiKey === null || apiKey === "") throw new JevError("Jev の API キーが見つからない", "no-key");
  const body = JSON.stringify({ state: input.state, model: input.model ?? JEV_MODEL, questions: input.questions });
  const url = input.endpoint ?? JEV_ENDPOINT;
  const timeoutMs = input.timeoutMs ?? 120000;
  const maxRetries = input.maxRetries ?? 3;
  const sleep = input.sleep ?? defaultSleep;
  return await callLoop(url, body, apiKey, timeoutMs, maxRetries, sleep);
}

async function callLoop(
  url: string,
  body: string,
  apiKey: string,
  timeoutMs: number,
  maxRetries: number,
  sleep: Sleep,
): Promise<JevResponse> {
  let rateRetries = 0;
  let otherRetried = false;
  for (;;) {
    const sent = await send(url, body, apiKey, timeoutMs);
    if (sent instanceof JevError) {
      if (otherRetried) throw sent;
      otherRetried = true;
      continue;
    }
    const action = retryOf(sent.status, rateRetries, otherRetried, maxRetries);
    if (action === "ok") return answersOf(sent.text, sent.status);
    if (action === "stop") throw httpError(sent.status, sent.text);
    if (action === "rate") {
      await sleep(retryWaitMs(sent.retryAfter, rateRetries));
      rateRetries += 1;
      continue;
    }
    otherRetried = true;
  }
}
