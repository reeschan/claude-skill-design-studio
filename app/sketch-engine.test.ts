// 背景スケッチのエンジン (app/sketch-engine.js) のテスト。受け入れ条件 (PBI-002) の
// 「同じコードなら同じ呼び出しの列」「自前の関数だけを使った式」「cover の変換」「誤りの種類」
// 「色付けの明暗の置き換え」「焼き込みの画質と大きさの下げ方」を、偽の 2D context で確かめる。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BAKE_FRAMES,
  BAKE_HEIGHT,
  BAKE_LIMIT_BYTES,
  BAKE_WIDTH,
  FRAME_TIMEOUT_MS,
  SKETCH_CONSTANTS,
  SKETCH_FUNCTIONS,
  SketchError,
  colorizeByLuminance,
  compileSketch,
  encodeWithinLimit,
} from "./sketch-engine.js";
import type { SketchContext, SketchPalette } from "./sketch-engine.js";

// 呼び出しの列。メソッド名と引数 (すべて数値) だけを残す
type Call = [name: string, ...args: number[]];

// 呼び出しを配列に記録する偽の 2D context。canvas の大きさは使わないので持たない
function createContext(): { ctx: SketchContext; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: number[]): void => {
      calls.push([name, ...args]);
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

// スケッチを frames フレーム動かし、記録した呼び出しの列を返す
function runSketch(code: string, frames: number, width = 400, height = 400): { calls: Call[]; usedColor: boolean } {
  const compiled = compileSketch(code);
  const { ctx, calls } = createContext();
  for (let frame = 0; frame < frames; frame += 1) {
    compiled.step(ctx, { width, height });
  }
  return { calls, usedColor: compiled.usedColor };
}

// SketchError を投げることを確かめ、投げた誤りを返す
function sketchErrorOf(run: () => void): SketchError {
  try {
    run();
  } catch (error) {
    if (!(error instanceof SketchError)) {
      assert.fail(`SketchError ではありません: ${String(error)}`);
    }
    return error;
  }
  assert.fail("SketchError が出ませんでした");
}

// 貼ってもらった種類の式 (PBI-002 の受け入れ条件の文字列をそのまま使う)
const PASTED_CODE = `t=0;draw=$=>{t||createCanvas(w=400,w);background(9).stroke(w,96);for(t+=PI/45,i=2e3;i--;){x=i%50;y=i/50;d=mag(k=x/8-3,e=y/8-3)**2/99;point(x*8+sin(t+d)*20,y*8+cos(t-d)*20)}}`;

void test("1. 同じコードを 3 フレーム動かすと、2 回やっても同じ呼び出しの列になる (random・noise 込み)", () => {
  const code = `t=0;draw=()=>{t+=0.1;background(9);stroke(200);point(random(100),random(100));point(noise(t)*100,noise(t,2)*100)}`;
  const first = runSketch(code, 3);
  const second = runSketch(code, 3);
  assert.deepEqual(second.calls, first.calls);
});

void test("2. 貼ってもらった種類の式がエラー無しで 2 フレーム動き、点を 1 つ以上描く", () => {
  const { calls } = runSketch(PASTED_CODE, 2, 1600, 900);
  const points = calls.filter((call) => call[0] === "fillRect");
  assert.ok(points.length > 0, "点を描いていません");
});

void test("3. createCanvas(400,400) を 1600×900 の ctx で動かすと、width・height は 400 で cover の変換が掛かる", () => {
  const { calls } = runSketch("createCanvas(400,400);draw=()=>{rect(0,0,width,height)}", 1, 1600, 900);
  const rectCall = calls.find((call) => call[0] === "rect");
  assert.deepEqual(rectCall, ["rect", 0, 0, 400, 400]);
  const transformCall = calls.findLastIndex((call) => call[0] === "setTransform");
  const rectAt = calls.findIndex((call) => call[0] === "rect");
  assert.ok(transformCall >= 0 && transformCall < rectAt, "描く前に cover の変換が掛かっていません");
  assert.deepEqual(calls[transformCall], ["setTransform", 4, 0, 0, 4, 0, -350]);
});

void test("4. 知らない名前・構文の誤り・draw の中の throw を kind で見分ける", () => {
  const compiled = compileSketch("draw=()=>{noise4D(1)}");
  const { ctx } = createContext();
  const unknown = sketchErrorOf(() => compiled.step(ctx, { width: 400, height: 400 }));
  assert.equal(unknown.kind, "unknown-name");
  assert.equal(unknown.name, "noise4D");

  const syntax = sketchErrorOf(() => compileSketch("draw=()=>{"));
  assert.equal(syntax.kind, "syntax");

  const runtimeCompiled = compileSketch(`draw=()=>{throw new Error("boom")}`);
  const runtime = sketchErrorOf(() => runtimeCompiled.step(ctx, { width: 400, height: 400 }));
  assert.equal(runtime.kind, "runtime");
});

void test("5. usedColor は無彩色だけなら false、有彩色を 1 度でも指定すれば true", () => {
  assert.equal(runSketch("draw=()=>{stroke(200);fill(0,128);background(9)}", 2).usedColor, false);
  assert.equal(runSketch("draw=()=>{stroke(255,0,0)}", 2).usedColor, true);
  assert.equal(runSketch(`draw=()=>{fill("red")}`, 2).usedColor, true);
});

void test("6. SKETCH_FUNCTIONS・SKETCH_CONSTANTS が data/sketch-api.json と同じで、どの名前も使える", () => {
  const apiPath = fileURLToPath(new URL("../data/sketch-api.json", import.meta.url));
  const api = JSON.parse(readFileSync(apiPath, "utf8")) as { functions: string[]; constants: string[] };
  assert.deepEqual(SKETCH_FUNCTIONS, api.functions);
  assert.deepEqual(SKETCH_CONSTANTS, api.constants);
  assert.equal(BAKE_WIDTH, 1600);
  assert.equal(BAKE_HEIGHT, 900);
  assert.equal(FRAME_TIMEOUT_MS, 2000);
  assert.equal(BAKE_LIMIT_BYTES, 300 * 1024);
  assert.equal(BAKE_FRAMES, 30);
  for (const name of [...SKETCH_FUNCTIONS, ...SKETCH_CONSTANTS]) {
    const compiled = compileSketch(`draw=()=>{${name};}`);
    const { ctx } = createContext();
    assert.doesNotThrow(() => compiled.step(ctx, { width: 400, height: 400 }), `${name} が使えません`);
  }
});

void test("7. colorizeByLuminance は明るさを background → primary → accent に置き換える", () => {
  const palette: SketchPalette = { background: [10, 20, 30], primary: [100, 150, 200], accent: [250, 240, 20] };
  const data = new Uint8ClampedArray([
    0,
    0,
    0,
    255, // 黒
    255,
    255,
    255,
    255, // 白
    128,
    128,
    128,
    255, // 明るさ 0.5 ちょうどの灰色
    7,
    8,
    9,
    0, // 透明
  ]);
  colorizeByLuminance(data, palette);
  assert.deepEqual([...data.slice(0, 4)], [...palette.background, 255]);
  assert.deepEqual([...data.slice(4, 8)], [...palette.accent, 255]);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(Math.abs((data[8 + channel] ?? 0) - (palette.primary[channel] ?? 0)) <= 1, "灰色が primary になっていません");
  }
  assert.deepEqual([...data.slice(12, 16)], [...palette.background, 255]);
});

void test("8. encodeWithinLimit は画質を下げてから大きさを下げ、最初に収まった組を返す", async () => {
  const sizeAt = (scale: number, quality: number): number => 1_000_000 * scale * scale * quality;
  const run = async (limit: number) => {
    const calls: Array<[number, number]> = [];
    const encode = (scale: number, quality: number): Promise<{ size: number }> => {
      calls.push([scale, quality]);
      return Promise.resolve({ size: sizeAt(scale, quality) });
    };
    const result = await encodeWithinLimit(encode, limit);
    return { calls, result };
  };

  const fitsFirst = await run(10_000_000);
  assert.equal(fitsFirst.result.scale, 1);
  assert.equal(fitsFirst.result.quality, 0.9);
  assert.deepEqual(fitsFirst.calls, [[1, 0.9]]);

  const fitsByQuality = await run(700_000);
  assert.equal(fitsByQuality.result.scale, 1);
  assert.equal(fitsByQuality.result.quality, 0.7);
  assert.deepEqual(fitsByQuality.calls, [
    [1, 0.9],
    [1, 0.8],
    [1, 0.7],
  ]);

  const fitsByScale = await run(250_000);
  assert.equal(fitsByScale.result.scale, 0.64);
  assert.equal(fitsByScale.result.quality, 0.5);
  assert.deepEqual(fitsByScale.calls, [
    [1, 0.9],
    [1, 0.8],
    [1, 0.7],
    [1, 0.6],
    [1, 0.5],
    [0.8, 0.5],
    [0.64, 0.5],
  ]);

  const neverFits = await run(0);
  assert.equal(neverFits.result.scale, 0.5);
  assert.equal(neverFits.result.quality, 0.5);
  assert.deepEqual(neverFits.calls, [
    [1, 0.9],
    [1, 0.8],
    [1, 0.7],
    [1, 0.6],
    [1, 0.5],
    [0.8, 0.5],
    [0.64, 0.5],
    [0.5, 0.5],
  ]);
});

void test("9. function 宣言の setup・draw でも動き、代入の書き方も動く", () => {
  const declared = runSketch("function setup(){createCanvas(400,400)}\nfunction draw(){background(0);point(10,10)}", 2, 1600, 900);
  const points = declared.calls.filter((call) => call[0] === "fillRect" && call[1] !== 0);
  assert.ok(points.length > 0, "function 宣言の draw が呼ばれていません");
  const cover = declared.calls.find((call) => call[0] === "setTransform" && call[1] === 4);
  assert.ok(cover, "function 宣言の setup が呼ばれていません");

  const assigned = runSketch("setup=()=>{createCanvas(400,400)};draw=()=>{point(1,1)}", 2, 1600, 900);
  const assignedPoints = assigned.calls.filter((call) => call[0] === "fillRect");
  assert.ok(assignedPoints.length > 0, "代入の draw が呼ばれていません");
});

void test("10. noLoop のあとの step では draw を呼ばない (焼き込みの 30 フレームでも 1 回)", () => {
  const compiled = compileSketch("count=0;setup=()=>{noLoop()};draw=()=>{count++;point(1,1)}");
  const { ctx, calls } = createContext();
  for (let frame = 0; frame < BAKE_FRAMES; frame += 1) {
    compiled.step(ctx, { width: 100, height: 100 });
  }
  const points = calls.filter((call) => call[0] === "fillRect");
  assert.equal(points.length, 1);
});
