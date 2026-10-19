// 背景スケッチの host。sandbox="allow-scripts" だけの iframe の中で動く普通のスクリプト。
// 親から init (sketch-engine.js の本文)・run・bake・stop を受け、Blob の module Worker で式を動かす。
// ライブの Worker と焼き込みの Worker は別に持つ (焼いている間もライブは動かす)。
// tick・frame が 2 秒来なければ Worker を terminate して親に時間切れを知らせる。時間切れのあとの
// 次の依頼では Worker を作り直す。描いたフレームは canvas に写し、baked・error は親に渡す。
const FRAME_TIMEOUT_MS = 2000;
const TIMEOUT_MESSAGE = "1 フレームが 2 秒を超えました";

const canvas = document.querySelector("canvas");
const bitmap = canvas === null ? null : canvas.getContext("bitmaprenderer");

// worker が null の間は次の依頼で作り直す。token は焼き込みの依頼を見分ける印
const live = { worker: null, timer: null, token: null };
const bake = { worker: null, timer: null, token: null };
let engine = "";

function dataOf(value) {
  return value !== null && typeof value === "object" ? value : {};
}

function clearTimer(slot) {
  if (slot.timer === null) return;
  clearTimeout(slot.timer);
  slot.timer = null;
}

function stopWorker(slot) {
  clearTimer(slot);
  if (slot.worker !== null) {
    slot.worker.terminate();
    slot.worker = null;
  }
  slot.token = null;
}

function postToParent(message) {
  parent.postMessage(message, "*");
}

// 誤りで Worker を捨てる。次の依頼では ensureWorker が作り直す
function fail(slot, payload) {
  const token = slot.token;
  stopWorker(slot);
  const message = { type: "error", kind: payload.kind, name: payload.name ?? null, message: payload.message ?? "" };
  if (token !== null) message.token = token;
  postToParent(message);
}

// tick・frame が来るたびに張り直す。来なければ Worker を止めて時間切れを知らせる
function armTimer(slot) {
  clearTimer(slot);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    fail(slot, { type: "error", kind: "timeout", name: null, message: TIMEOUT_MESSAGE });
  }, FRAME_TIMEOUT_MS);
}

function createWorker() {
  const blob = new Blob([engine], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob), { type: "module" });
}

function ensureWorker(slot) {
  if (slot.worker !== null) return slot.worker;
  const worker = createWorker();
  slot.worker = worker;
  worker.addEventListener("message", (event) => {
    if (slot.worker !== worker) return;
    onWorkerMessage(slot, dataOf(event.data));
  });
  return worker;
}

function drawFrame(image) {
  if (bitmap === null || image === null || image === undefined) return;
  bitmap.transferFromImageBitmap(image);
}

function finishBake(slot, message) {
  const token = slot.token;
  stopWorker(slot);
  const payload = { type: "baked", image: message.image, bytes: message.bytes, scale: message.scale, quality: message.quality };
  if (token !== null) payload.token = token;
  postToParent(payload);
}

function onWorkerMessage(slot, message) {
  if (message.type === "tick" || message.type === "frame") {
    if (message.type === "frame") drawFrame(message.bitmap);
    armTimer(slot);
    return;
  }
  // 描き終えて止まったスケッチ。これ以上 tick・frame は来ないので、時間切れの時計だけ外す
  // (Worker は止めない。次の run でそのまま使う)
  if (message.type === "idle") {
    clearTimer(slot);
    return;
  }
  if (message.type === "baked") {
    finishBake(slot, message);
    return;
  }
  if (message.type === "error") fail(slot, message);
}

function stopAll() {
  stopWorker(live);
  stopWorker(bake);
}

function startRun(message) {
  const worker = ensureWorker(live);
  live.token = null;
  worker.postMessage({ type: "run", code: message.code, width: message.width, height: message.height, palette: message.palette });
  armTimer(live);
}

function startBake(message) {
  stopWorker(bake);
  const worker = ensureWorker(bake);
  bake.token = typeof message.token === "number" ? message.token : null;
  worker.postMessage({ type: "bake", code: message.code, palette: message.palette });
  armTimer(bake);
}

function onInit(message) {
  engine = typeof message.engine === "string" ? message.engine : "";
  stopAll();
}

function onMessage(event) {
  if (event.source !== parent) return;
  const message = dataOf(event.data);
  if (message.type === "init") onInit(message);
  else if (message.type === "run") startRun(message);
  else if (message.type === "bake") startBake(message);
  else if (message.type === "stop") stopAll();
}

addEventListener("message", onMessage);
// 親はこの合図で init (エンジンの本文) を送る
postToParent({ type: "ready" });
