// 背景スケッチのエンジン (app/sketch-engine.js) の型。ブラウザの Worker と node のテストの
// どちらからも同じ名前で使えるように、export している値と関数だけを宣言する。
import type { SketchPalette } from "../core/types.js";

export type { SketchPalette };

export type SketchErrorKind = "syntax" | "unknown-name" | "runtime" | "timeout";

// スケッチが描く先。テストでは呼び出しを記録する偽物を渡す
export interface SketchContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
}

// step に渡す、実際のキャンバスの大きさ
export interface SketchSize {
  width: number;
  height: number;
}

// コンパイルしたスケッチ。1 回目の step で最上位のコード → setup → draw、2 回目からは draw だけ動く
export interface CompiledSketch {
  step(ctx: SketchContext, size: SketchSize): void;
  readonly usedColor: boolean;
  readonly isLooping: boolean;
}

export class SketchError extends Error {
  readonly kind: SketchErrorKind;
  // 知らない名前のときはその名前。構文の誤りのときは実行時に null になる (Error の name に合わせて string と宣言する)
  name: string;
  constructor(kind: SketchErrorKind, name?: string | null, message?: string);
}

export const SKETCH_FUNCTIONS: readonly string[];
export const SKETCH_CONSTANTS: readonly string[];

export const BAKE_WIDTH: number;
export const BAKE_HEIGHT: number;
export const FRAME_TIMEOUT_MS: number;
export const BAKE_LIMIT_BYTES: number;
export const BAKE_FRAMES: number;

// 構文の誤りは SketchError("syntax")。知らない名前と実行時の誤りは step のときに投げる
export function compileSketch(code: string): CompiledSketch;

export function colorizeByLuminance(data: Uint8ClampedArray, palette: SketchPalette): void;

// encode(scale, quality) が { size } を持つもの (ブラウザでは Blob) を返す。最初に収まった組を返す
export type EncodedImage = { size: number };
export type EncodeResult<T extends EncodedImage> = { result: T; scale: number; quality: number };
export function encodeWithinLimit<T extends EncodedImage>(
  encode: (scale: number, quality: number) => T | Promise<T>,
  limit?: number,
): Promise<EncodeResult<T>>;
