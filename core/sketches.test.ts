// 同梱の見本のスケッチ (data/sketches.json) と、自前の関数・定数の一覧 (data/sketch-api.json) の
// 読み込みを外から確かめる。見本は偽の 2D context で 1600×900 の 3 フレームを動かし、
// 描くこと・無彩色であること・1 フレームが 2 秒以内であることを見る
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileSketch } from "../app/sketch-engine.js";
import type { SketchContext } from "../app/sketch-engine.js";
import { SKETCH_CODE_MAX } from "./background.ts";
import { loadSketchApi, loadSketchSamples } from "./sketches.ts";
import type { SketchSample } from "./types.ts";

// 見本の数と、1 フレームの制限時間 (PBI-003 の受け入れ条件)
const SAMPLE_COUNT = 5;
const FRAME_LIMIT_MS = 2000;
const WIDTH = 1600;
const HEIGHT = 900;

// id の形と、日本語を含むかどうか
const ID_RE = /^[a-z][a-z0-9-]*$/;
const JAPANESE_RE = /[ぁ-んァ-ヶ一-龠]/;
// 何かを描いたと見なす呼び出し (点は fillRect、円は ellipse、線は moveTo・lineTo・stroke)
const DRAW_CALLS: ReadonlySet<string> = new Set(["fillRect", "rect", "ellipse", "moveTo", "lineTo", "fill", "stroke"]);

// 呼び出しの名前だけを記録する偽の 2D context
function createContext(): { ctx: SketchContext; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (): void => {
    calls.push(name);
  };
  const ctx: SketchContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    save: record("save"),
    restore: record("restore"),
    setTransform: record("setTransform"),
    translate: record("translate"),
    rotate: record("rotate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    rect: record("rect"),
    ellipse: record("ellipse"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
  };
  return { ctx, calls };
}

// data/sketch-api.json を直接読む (loadSketchApi の答え合わせ用)
function sketchApiFile(): { functions: string[]; constants: string[] } {
  const path = fileURLToPath(new URL("../data/sketch-api.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as { functions: string[]; constants: string[] };
}

void test("見本は 5 件で、id・名前・説明・コードの形が決まりどおり", () => {
  const samples = loadSketchSamples();
  assert.equal(samples.length, SAMPLE_COUNT);
  assert.equal(SKETCH_CODE_MAX, 8000);

  const ids = samples.map((sample) => sample.id);
  assert.equal(new Set(ids).size, ids.length, "id が重複しています");
  for (const sample of samples) {
    assert.match(sample.id, ID_RE, `${sample.id}: id の形`);
    assert.notEqual(sample.name.trim(), "", `${sample.id}: name が空`);
    assert.notEqual(sample.description.trim(), "", `${sample.id}: description が空`);
    assert.match(sample.name, JAPANESE_RE, `${sample.id}: name が日本語でない`);
    assert.match(sample.description, JAPANESE_RE, `${sample.id}: description が日本語でない`);
    assert.ok(sample.code.length >= 1 && sample.code.length <= SKETCH_CODE_MAX, `${sample.id}: code の長さ`);
  }
});

void test("どの見本も 1600×900 の偽の context で 3 フレーム動き、毎フレーム何かを描く", () => {
  for (const sample of loadSketchSamples()) {
    const compiled = compileSketch(sample.code);
    const { ctx, calls } = createContext();
    for (let frame = 0; frame < 3; frame += 1) {
      calls.length = 0;
      compiled.step(ctx, { width: WIDTH, height: HEIGHT });
      assert.ok(
        calls.some((name) => DRAW_CALLS.has(name)),
        `${sample.id}: ${frame + 1} フレーム目に何も描いていません`,
      );
    }
  }
});

void test("どの見本も無彩色だけで描く (テーマの色で色付けされる)", () => {
  for (const sample of loadSketchSamples()) {
    const compiled = compileSketch(sample.code);
    const { ctx } = createContext();
    for (let frame = 0; frame < 3; frame += 1) compiled.step(ctx, { width: WIDTH, height: HEIGHT });
    assert.equal(compiled.usedColor, false, `${sample.id}: 有彩色を指定しています`);
  }
});

void test("どの見本も 1600×900 の 1 フレームを 2 秒以内に描き終える", () => {
  for (const sample of loadSketchSamples()) {
    const compiled = compileSketch(sample.code);
    const { ctx } = createContext();
    const startedAt = performance.now();
    compiled.step(ctx, { width: WIDTH, height: HEIGHT });
    const elapsed = performance.now() - startedAt;
    assert.ok(elapsed < FRAME_LIMIT_MS, `${sample.id}: ${elapsed.toFixed(1)}ms`);
  }
});

void test("loadSketchApi は data/sketch-api.json の functions・constants と同じ", () => {
  const api = sketchApiFile();
  assert.deepEqual(loadSketchApi(), { functions: api.functions, constants: api.constants });
});

void test("loadSketchSamples は呼ぶたびに別の配列を返し、書き換えても次の呼び出しに響かない", () => {
  const first = loadSketchSamples();
  const second = loadSketchSamples();
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);

  const expectedName = second[0]?.name;
  const sample: SketchSample | undefined = first[0];
  assert.ok(sample !== undefined);
  sample.name = "書き換えた名前";
  first.pop();

  const third = loadSketchSamples();
  assert.equal(third.length, SAMPLE_COUNT);
  assert.equal(third[0]?.name, expectedName);
});
