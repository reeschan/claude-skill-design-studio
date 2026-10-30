// Jev クライアント。127.0.0.1 のモックだけを相手にし、本物の API は呼ばない
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { callJev, jevApiKey, JEV_ENDPOINT, JEV_MODEL, JevError } from "./jev.ts";

const QUESTIONS = { fit: { type: "score" as const, instructions: "どれくらい合うか", criteria: ["低い", "高い"] } };
const OK = {
  model: JEV_MODEL,
  answers: { fit: { type: "score", score: 2.4, confidence: 0.8 } },
  usage: { input_tokens: 1, output_tokens: 1 },
};

type MockReply = { status: number; body: unknown; retryAfter?: string };

async function withMock(replies: MockReply[], fn: (url: string, bodies: string[]) => Promise<void>): Promise<void> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      bodies.push(raw);
      const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
      if (reply === undefined) return;
      res.writeHead(reply.status, { "content-type": "application/json", ...(reply.retryAfter ? { "retry-after": reply.retryAfter } : {}) });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}/v1/systemone`, bodies);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void test("エンドポイントと、キーの優先 (環境変数、次に資格情報ファイル)", () => {
  assert.equal(JEV_ENDPOINT, "https://api.typesafe.ai/v1/systemone");
  assert.equal(jevApiKey({ TYPESAFE_API_KEY: "env-key" }), "env-key");
  const dir = mkdtempSync(join(tmpdir(), "jev-key-"));
  try {
    const file = join(dir, "credentials.json");
    writeFileSync(file, JSON.stringify({ api_key: "file-key" }));
    assert.equal(jevApiKey({ TYPESAFE_CREDENTIALS_FILE: file }), "file-key");
    assert.equal(jevApiKey({ TYPESAFE_API_KEY: "env-key", TYPESAFE_CREDENTIALS_FILE: file }), "env-key");
    assert.equal(jevApiKey({ TYPESAFE_CREDENTIALS_FILE: join(dir, "missing.json") }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("200 の answers を返し、本文に model と questions が入る", async () => {
  await withMock([{ status: 200, body: OK }], async (url, bodies) => {
    const result = await callJev({
      state: "背景がゆっくり",
      questions: QUESTIONS,
      apiKey: "test-key",
      endpoint: url,
      sleep: async () => {},
    });
    assert.equal(result.answers.fit?.score, 2.4);
    const sent = JSON.parse(bodies[0] ?? "{}") as { state: string; model: string; questions: unknown };
    assert.equal(sent.state, "背景がゆっくり");
    assert.equal(sent.model, JEV_MODEL);
    assert.deepEqual(sent.questions, QUESTIONS);
  });
});

void test("401 は再試行せず、キーはエラーに出さない", async () => {
  await withMock([{ status: 401, body: { error: "unauthorized" } }], async (url, bodies) => {
    await assert.rejects(
      () => callJev({ state: "t", questions: QUESTIONS, apiKey: "test-key", endpoint: url, sleep: async () => {} }),
      (error: unknown) => error instanceof JevError && error.code === "http" && error.status === 401 && !error.message.includes("test-key"),
    );
    assert.equal(bodies.length, 1);
  });
});

void test("キーが無ければ HTTP を呼ばない", async () => {
  await withMock([{ status: 200, body: OK }], async (url, bodies) => {
    await assert.rejects(
      () =>
        callJev({
          state: "t",
          questions: QUESTIONS,
          apiKey: null,
          endpoint: url,
          env: { TYPESAFE_CREDENTIALS_FILE: join(tmpdir(), "nope.json") },
        }),
      (error: unknown) => error instanceof JevError && error.code === "no-key",
    );
    assert.equal(bodies.length, 0);
  });
});

void test("answers の無い 200 は bad-response", async () => {
  await withMock([{ status: 200, body: { model: JEV_MODEL } }], async (url) => {
    await assert.rejects(
      () => callJev({ state: "t", questions: QUESTIONS, apiKey: "test-key", endpoint: url, sleep: async () => {} }),
      (error: unknown) => error instanceof JevError && error.code === "bad-response",
    );
  });
});
