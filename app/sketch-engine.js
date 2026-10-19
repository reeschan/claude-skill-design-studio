// 背景スケッチのエンジン。p5.js のよく使う関数だけを自前で用意する。
// ブラウザでは Blob の module Worker としてそのまま動き、node のテストからは import して使う。
// Worker として 1 ファイルで動かすため、このファイルに import は書かない。
// node で import したときは何もしない (Worker の処理は WorkerGlobalScope があるときだけ動く)。

export const SKETCH_FUNCTIONS = [
  "createCanvas",
  "resizeCanvas",
  "background",
  "clear",
  "fill",
  "noFill",
  "stroke",
  "noStroke",
  "strokeWeight",
  "point",
  "line",
  "rect",
  "square",
  "circle",
  "ellipse",
  "triangle",
  "quad",
  "arc",
  "beginShape",
  "vertex",
  "endShape",
  "push",
  "pop",
  "translate",
  "rotate",
  "scale",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sqrt",
  "sq",
  "pow",
  "exp",
  "log",
  "abs",
  "floor",
  "ceil",
  "round",
  "min",
  "max",
  "mag",
  "dist",
  "map",
  "lerp",
  "constrain",
  "fract",
  "noise",
  "noiseSeed",
  "random",
  "randomSeed",
  "millis",
  "frameRate",
  "noLoop",
  "loop",
];

export const SKETCH_CONSTANTS = ["PI", "TWO_PI", "HALF_PI", "QUARTER_PI", "TAU", "CLOSE"];

export const BAKE_WIDTH = 1600;
export const BAKE_HEIGHT = 900;
export const FRAME_TIMEOUT_MS = 2000;
export const BAKE_LIMIT_BYTES = 300 * 1024;
export const BAKE_FRAMES = 30;

// スケッチから読める、自前の関数でも定数でもない JS の名前
const JS_GLOBALS = new Map([
  ["Math", Math],
  ["Number", Number],
  ["Array", Array],
  ["Object", Object],
  ["JSON", JSON],
  ["String", String],
  ["Boolean", Boolean],
  ["Error", Error],
  ["Infinity", Infinity],
  ["NaN", NaN],
  ["undefined", undefined],
  ["isNaN", isNaN],
  ["parseInt", parseInt],
  ["parseFloat", parseFloat],
]);

const CONSTANT_VALUES = new Map([
  ["PI", Math.PI],
  ["TWO_PI", Math.PI * 2],
  ["HALF_PI", Math.PI / 2],
  ["QUARTER_PI", Math.PI / 4],
  ["TAU", Math.PI * 2],
  ["CLOSE", "close"],
]);

const DEFAULT_FILL = { css: "rgba(255,255,255,1)", chromatic: false };
const DEFAULT_STROKE = { css: "rgba(0,0,0,1)", chromatic: false };

export class SketchError extends Error {
  constructor(kind, name = null, message) {
    super(message ?? sketchErrorMessage(kind, name));
    this.kind = kind;
    this.name = name;
  }
}

function sketchErrorMessage(kind, name) {
  if (kind === "unknown-name") return `用意していない名前です: ${name}`;
  if (kind === "syntax") return "スケッチの構文が正しくありません";
  if (kind === "timeout") return "スケッチの 1 フレームが時間切れになりました";
  return "スケッチの実行中に誤りがありました";
}

// 決まった種の擬似乱数 (mulberry32)。既定の種は 1
function mulberry32(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// 種つきの Perlin 風の値。0〜1 を返す
function createNoise(seed) {
  const random = mulberry32(seed);
  const source = Array.from({ length: 256 }, (_, index) => index);
  for (let index = 255; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const value = source[index];
    source[index] = source[swap];
    source[swap] = value;
  }
  const perm = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) perm[index] = source[index & 255];
  return (x, y, z) => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);
    const X = floorX & 255;
    const Y = floorY & 255;
    const Z = floorZ & 255;
    const fx = x - floorX;
    const fy = y - floorY;
    const fz = z - floorZ;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    const value = lerpNumber(
      lerpNumber(
        lerpNumber(gradient(perm[AA], fx, fy, fz), gradient(perm[BA], fx - 1, fy, fz), u),
        lerpNumber(gradient(perm[AB], fx, fy - 1, fz), gradient(perm[BB], fx - 1, fy - 1, fz), u),
        v,
      ),
      lerpNumber(
        lerpNumber(gradient(perm[AA + 1], fx, fy, fz - 1), gradient(perm[BA + 1], fx - 1, fy, fz - 1), u),
        lerpNumber(gradient(perm[AB + 1], fx, fy - 1, fz - 1), gradient(perm[BB + 1], fx - 1, fy - 1, fz - 1), u),
        v,
      ),
      w,
    );
    return Math.min(1, Math.max(0, value * 0.5 + 0.5));
  };
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function gradient(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function lerpNumber(start, stop, amount) {
  return start + (stop - start) * amount;
}

// 色の引数を ctx に渡す文字列にする。無彩色かどうかも返す
function colorOf(args) {
  const first = args[0];
  if (typeof first === "string") return { css: first, chromatic: true };
  if (args.length >= 3) {
    const red = Number(args[0]);
    const green = Number(args[1]);
    const blue = Number(args[2]);
    const alpha = args.length >= 4 ? Number(args[3]) : 255;
    return { css: `rgba(${red},${green},${blue},${alpha / 255})`, chromatic: !(red === green && green === blue) };
  }
  const gray = Number(first);
  const alpha = args.length >= 2 ? Number(args[1]) : 255;
  return { css: `rgba(${gray},${gray},${gray},${alpha / 255})`, chromatic: false };
}

function createState() {
  return {
    assigned: new Map(),
    rng: mulberry32(1),
    noise: createNoise(1),
    usedColor: false,
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    weight: 1,
    requestedWidth: null,
    requestedHeight: null,
    actualWidth: 0,
    actualHeight: 0,
    frameCount: 0,
    looping: true,
    setup: undefined,
    draw: undefined,
    shape: null,
    ctx: null,
    startedAt: Date.now(),
    fps: 60,
  };
}

// すべての関数をメソッドに持つ同じオブジェクトを返す (background(9).stroke(…) のため)
function createFunctions(state) {
  const chainObject = {};
  const functions = new Map();
  const define = (name, run) => {
    functions.set(name, run);
  };
  const paint = () => {
    const context = state.ctx;
    if (state.fill) {
      context.fillStyle = state.fill.css;
      context.fill();
    }
    if (state.stroke) {
      context.strokeStyle = state.stroke.css;
      context.lineWidth = state.weight;
      context.stroke();
    }
  };
  const strokeOnly = () => {
    if (!state.stroke) return;
    const context = state.ctx;
    context.strokeStyle = state.stroke.css;
    context.lineWidth = state.weight;
    context.stroke();
  };
  const markColor = (color) => {
    if (color.chromatic) state.usedColor = true;
  };

  define("createCanvas", (width, height) => {
    state.requestedWidth = Number(width);
    state.requestedHeight = Number(height);
    return chainObject;
  });
  define("resizeCanvas", (width, height) => {
    state.requestedWidth = Number(width);
    state.requestedHeight = Number(height);
    return chainObject;
  });
  define("background", (...args) => {
    const color = colorOf(args);
    markColor(color);
    const context = state.ctx;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = color.css;
    context.fillRect(0, 0, state.actualWidth, state.actualHeight);
    context.restore();
    return chainObject;
  });
  define("clear", () => {
    const context = state.ctx;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, state.actualWidth, state.actualHeight);
    context.restore();
    return chainObject;
  });
  define("fill", (...args) => {
    state.fill = args.length === 0 ? DEFAULT_FILL : colorOf(args);
    markColor(state.fill);
    return chainObject;
  });
  define("noFill", () => {
    state.fill = null;
    return chainObject;
  });
  define("stroke", (...args) => {
    state.stroke = args.length === 0 ? DEFAULT_STROKE : colorOf(args);
    markColor(state.stroke);
    return chainObject;
  });
  define("noStroke", () => {
    state.stroke = null;
    return chainObject;
  });
  define("strokeWeight", (weight) => {
    state.weight = Number(weight);
    return chainObject;
  });
  define("point", (x, y) => {
    if (!state.stroke) return chainObject;
    const context = state.ctx;
    context.fillStyle = state.stroke.css;
    const size = state.weight;
    context.fillRect(x - size / 2, y - size / 2, size, size);
    return chainObject;
  });
  define("line", (x1, y1, x2, y2) => {
    if (!state.stroke) return chainObject;
    const context = state.ctx;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    strokeOnly();
    return chainObject;
  });
  define("rect", (x, y, width, height) => {
    const context = state.ctx;
    context.beginPath();
    context.rect(x, y, width, height);
    paint();
    return chainObject;
  });
  define("square", (x, y, size) => {
    const context = state.ctx;
    context.beginPath();
    context.rect(x, y, size, size);
    paint();
    return chainObject;
  });
  define("circle", (x, y, diameter) => {
    const context = state.ctx;
    context.beginPath();
    context.ellipse(x, y, diameter / 2, diameter / 2, 0, 0, Math.PI * 2);
    paint();
    return chainObject;
  });
  define("ellipse", (x, y, width, height) => {
    const context = state.ctx;
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
    paint();
    return chainObject;
  });
  define("triangle", (x1, y1, x2, y2, x3, y3) => {
    const context = state.ctx;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineTo(x3, y3);
    context.closePath();
    paint();
    return chainObject;
  });
  define("quad", (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const context = state.ctx;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.lineTo(x3, y3);
    context.lineTo(x4, y4);
    context.closePath();
    paint();
    return chainObject;
  });
  define("arc", (x, y, width, height, start, stop, mode) => {
    const context = state.ctx;
    context.beginPath();
    context.ellipse(x, y, width / 2, height / 2, 0, start, stop);
    if (mode === "close") context.closePath();
    paint();
    return chainObject;
  });
  define("beginShape", () => {
    state.shape = [];
    return chainObject;
  });
  define("vertex", (x, y) => {
    if (state.shape !== null) state.shape.push([x, y]);
    return chainObject;
  });
  define("endShape", (mode) => {
    const points = state.shape ?? [];
    state.shape = null;
    if (points.length === 0) return chainObject;
    const context = state.ctx;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    if (mode === "close") context.closePath();
    paint();
    return chainObject;
  });
  define("push", () => {
    state.ctx.save();
    return chainObject;
  });
  define("pop", () => {
    state.ctx.restore();
    return chainObject;
  });
  define("translate", (x, y) => {
    state.ctx.translate(x, y);
    return chainObject;
  });
  define("rotate", (angle) => {
    state.ctx.rotate(angle);
    return chainObject;
  });
  define("scale", (x, y) => {
    state.ctx.scale(x, y);
    return chainObject;
  });

  define("sin", (angle) => Math.sin(angle));
  define("cos", (angle) => Math.cos(angle));
  define("tan", (angle) => Math.tan(angle));
  define("asin", (value) => Math.asin(value));
  define("acos", (value) => Math.acos(value));
  define("atan", (y, x) => (x === undefined ? Math.atan(y) : Math.atan2(y, x)));
  define("atan2", (y, x) => Math.atan2(y, x));
  define("sqrt", (value) => Math.sqrt(value));
  define("sq", (value) => value * value);
  define("pow", (base, exponent) => base ** exponent);
  define("exp", (value) => Math.exp(value));
  define("log", (value) => Math.log(value));
  define("abs", (value) => Math.abs(value));
  define("floor", (value) => Math.floor(value));
  define("ceil", (value) => Math.ceil(value));
  define("round", (value) => Math.round(value));
  define("min", (...values) => Math.min(...values));
  define("max", (...values) => Math.max(...values));
  define("mag", (...values) => Math.hypot(...values));
  define("dist", (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1));
  define("map", (value, start1, stop1, start2, stop2) => start2 + ((value - start1) * (stop2 - start2)) / (stop1 - start1));
  define("lerp", (start, stop, amount) => start + (stop - start) * amount);
  define("constrain", (value, low, high) => Math.min(high, Math.max(low, value)));
  define("fract", (value) => value - Math.floor(value));
  define("noise", (x, y = 0, z = 0) => state.noise(x, y, z));
  define("noiseSeed", (seed) => {
    state.noise = createNoise(Number(seed));
    return chainObject;
  });
  define("random", (first, second) => {
    if (first === undefined) return state.rng();
    if (Array.isArray(first)) return first[Math.floor(state.rng() * first.length)];
    if (second === undefined) return state.rng() * Number(first);
    const low = Number(first);
    const high = Number(second);
    return low + state.rng() * (high - low);
  });
  define("randomSeed", (seed) => {
    state.rng = mulberry32(Number(seed));
    return chainObject;
  });
  define("millis", () => Date.now() - state.startedAt);
  define("frameRate", (value) => {
    if (value === undefined) return state.fps;
    state.fps = Number(value);
    return chainObject;
  });
  define("noLoop", () => {
    state.looping = false;
    return chainObject;
  });
  define("loop", () => {
    state.looping = true;
    return chainObject;
  });

  for (const [name, run] of functions) chainObject[name] = run;
  return functions;
}

// スケッチから見える名前の解決。代入した名前 → 関数 → 定数 → width など → JS の名前、の順
function createScope(state, functions) {
  const dynamicValues = new Map([
    ["width", () => state.requestedWidth ?? state.actualWidth],
    ["height", () => state.requestedHeight ?? state.actualHeight],
    ["frameCount", () => state.frameCount],
  ]);
  return new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) => {
        if (key === Symbol.unscopables) return undefined;
        if (typeof key !== "string") return undefined;
        if (state.assigned.has(key)) return state.assigned.get(key);
        if (functions.has(key)) return functions.get(key);
        if (CONSTANT_VALUES.has(key)) return CONSTANT_VALUES.get(key);
        if (dynamicValues.has(key)) return dynamicValues.get(key)();
        if (JS_GLOBALS.has(key)) return JS_GLOBALS.get(key);
        throw new SketchError("unknown-name", key);
      },
      set: (_target, key, value) => {
        if (typeof key === "string") state.assigned.set(key, value);
        return true;
      },
    },
  );
}

function applyCover(state) {
  const requestedWidth = state.requestedWidth || state.actualWidth;
  const requestedHeight = state.requestedHeight || state.actualHeight;
  const scale = Math.max(state.actualWidth / requestedWidth, state.actualHeight / requestedHeight);
  const offsetX = (state.actualWidth - requestedWidth * scale) / 2;
  const offsetY = (state.actualHeight - requestedHeight * scale) / 2;
  state.ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
}

function asSketchError(error) {
  if (error instanceof SketchError) return error;
  return new SketchError("runtime", null, error instanceof Error ? error.message : String(error));
}

export function compileSketch(code) {
  const state = createState();
  const functions = createFunctions(state);
  const scope = createScope(state, functions);
  let body;
  try {
    // with を使うため strict にしない。scope は Proxy で、has が常に true。
    // function 宣言の setup・draw は Annex B で関数の var の束縛に入り Proxy の set を通らないので、
    // with の外から typeof で拾って返す (代入があればそちらを優先する)
    body = new Function(
      "scope",
      "with (scope) { " +
        code +
        '\n}\nreturn { setup: typeof setup === "function" ? setup : undefined, draw: typeof draw === "function" ? draw : undefined };',
    );
  } catch (error) {
    throw new SketchError("syntax", null, error instanceof Error ? error.message : undefined);
  }

  return {
    get usedColor() {
      return state.usedColor;
    },
    get isLooping() {
      return state.looping;
    },
    step(ctx, size) {
      state.ctx = ctx;
      state.actualWidth = size.width;
      state.actualHeight = size.height;
      state.frameCount += 1;
      applyCover(state);
      // noLoop のあとは p5 と同じく draw を呼ばない。noLoop を呼んだフレームの draw は呼ぶので、
      // 判定はフレームの初めの状態で行う
      const shouldDraw = state.looping;
      try {
        if (state.frameCount === 1) {
          const declared = body(scope) ?? {};
          applyCover(state);
          state.setup = valueOf(state, declared, "setup");
          if (state.setup !== undefined) {
            if (typeof state.setup !== "function") throw new Error("setup は関数ではありません");
            state.setup();
            applyCover(state);
          }
          state.draw = valueOf(state, declared, "draw");
        }
        if (state.draw === undefined) return;
        if (typeof state.draw !== "function") throw new Error("draw は関数ではありません");
        if (!shouldDraw) return;
        state.draw();
      } catch (error) {
        throw asSketchError(error);
      }
    },
  };
}

// スケッチが代入した名前を優先し、無ければ function 宣言で拾ったものを使う
function valueOf(state, declared, name) {
  if (state.assigned.has(name)) return state.assigned.get(name);
  return declared[name];
}

export function colorizeByLuminance(data, palette) {
  for (let at = 0; at < data.length; at += 4) {
    const red = data[at];
    const green = data[at + 1];
    const blue = data[at + 2];
    const alpha = data[at + 3];
    const luminance = ((0.2126 * red + 0.7152 * green + 0.0722 * blue) * (alpha / 255)) / 255;
    const from = luminance <= 0.5 ? palette.background : palette.primary;
    const to = luminance <= 0.5 ? palette.primary : palette.accent;
    const amount = luminance <= 0.5 ? luminance * 2 : (luminance - 0.5) * 2;
    data[at] = Math.round(from[0] + (to[0] - from[0]) * amount);
    data[at + 1] = Math.round(from[1] + (to[1] - from[1]) * amount);
    data[at + 2] = Math.round(from[2] + (to[2] - from[2]) * amount);
    data[at + 3] = 255;
  }
}

export async function encodeWithinLimit(encode, limit = BAKE_LIMIT_BYTES) {
  let last = null;
  const qualitySteps = [0.9, 0.8, 0.7, 0.6, 0.5];
  for (const quality of qualitySteps) {
    const result = await encode(1, quality);
    last = { result, scale: 1, quality };
    if (result.size <= limit) return last;
  }
  for (const scale of [0.8, 0.64, 0.5]) {
    const result = await encode(scale, 0.5);
    last = { result, scale, quality: 0.5 };
    if (result.size <= limit) return last;
  }
  return last;
}

// Worker として動いたときだけ、メッセージを受けて描く
function errorPayload(error) {
  if (error instanceof SketchError) {
    return { type: "error", kind: error.kind, name: error.name, message: error.message };
  }
  return { type: "error", kind: "runtime", name: null, message: error instanceof Error ? error.message : String(error) };
}

function colorizeCanvas(ctx, width, height, palette) {
  if (!palette) return;
  const image = ctx.getImageData(0, 0, width, height);
  colorizeByLuminance(image.data, palette);
  ctx.putImageData(image, 0, 0);
}

function encodeCanvas(canvas, scale, quality) {
  if (scale === 1) return canvas.convertToBlob({ type: "image/webp", quality });
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const small = new OffscreenCanvas(width, height);
  small.getContext("2d").drawImage(canvas, 0, 0, width, height);
  return small.convertToBlob({ type: "image/webp", quality });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function installWorker() {
  const live = {
    running: false,
    timer: null,
    compiled: null,
    ctx: null,
    outCtx: null,
    width: 0,
    height: 0,
    palette: null,
  };

  const stopLive = () => {
    live.running = false;
    if (live.timer !== null) {
      clearTimeout(live.timer);
      live.timer = null;
    }
  };

  const schedule = () => {
    if (!live.running) return;
    live.timer = setTimeout(drawLiveFrame, 33);
  };

  const drawLiveFrame = () => {
    if (!live.running) return;
    try {
      const { compiled, ctx, outCtx, width, height } = live;
      // スケッチは描く用の canvas に描き続ける (transfer しないので前のフレームの絵が残る)。
      // 出す用の canvas に写してから色付けし、そちらを transfer する
      compiled.step(ctx, { width, height });
      self.postMessage({ type: "tick" });
      outCtx.clearRect(0, 0, width, height);
      outCtx.drawImage(ctx.canvas, 0, 0);
      if (!compiled.usedColor) colorizeCanvas(outCtx, width, height, live.palette);
      const bitmap = outCtx.canvas.transferToImageBitmap();
      self.postMessage({ type: "frame", bitmap }, [bitmap]);
      if (!compiled.isLooping) {
        live.running = false;
        // 描き終えて止まったスケッチは、これ以上 tick・frame を送らない。host に時間切れの時計を
        // 外してもらう (Worker は止めない。次の run でそのまま使う)
        self.postMessage({ type: "idle" });
        return;
      }
      schedule();
    } catch (error) {
      stopLive();
      self.postMessage(errorPayload(error));
    }
  };

  const startRun = (message) => {
    stopLive();
    const width = Number(message.width) || BAKE_WIDTH;
    const height = Number(message.height) || BAKE_HEIGHT;
    const canvas = new OffscreenCanvas(width, height);
    const output = new OffscreenCanvas(width, height);
    live.compiled = compileSketch(message.code);
    live.ctx = canvas.getContext("2d");
    live.outCtx = output.getContext("2d");
    live.width = width;
    live.height = height;
    live.palette = message.palette;
    live.running = true;
    schedule();
  };

  const bake = async (message) => {
    try {
      const compiled = compileSketch(message.code);
      const canvas = new OffscreenCanvas(BAKE_WIDTH, BAKE_HEIGHT);
      const ctx = canvas.getContext("2d");
      for (let frame = 0; frame < BAKE_FRAMES; frame += 1) {
        // noLoop のスケッチは 1 回だけ描く
        if (frame > 0 && !compiled.isLooping) break;
        compiled.step(ctx, { width: BAKE_WIDTH, height: BAKE_HEIGHT });
        self.postMessage({ type: "tick" });
      }
      if (!compiled.usedColor) colorizeCanvas(ctx, BAKE_WIDTH, BAKE_HEIGHT, message.palette);
      self.postMessage({ type: "tick" });
      const encoded = await encodeWithinLimit((scale, quality) => {
        // 大きい WebP の作り直しで tick が途切れて時間切れにならないように、毎回送る
        self.postMessage({ type: "tick" });
        return encodeCanvas(canvas, scale, quality);
      });
      const image = `data:image/webp;base64,${await blobToBase64(encoded.result)}`;
      self.postMessage({ type: "baked", image, bytes: encoded.result.size, scale: encoded.scale, quality: encoded.quality });
    } catch (error) {
      self.postMessage(errorPayload(error));
    }
  };

  self.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    try {
      if (message.type === "run") startRun(message);
      else if (message.type === "bake") void bake(message);
      else if (message.type === "stop") stopLive();
    } catch (error) {
      self.postMessage(errorPayload(error));
    }
  });
}

if (typeof WorkerGlobalScope !== "undefined") {
  installWorker();
}
