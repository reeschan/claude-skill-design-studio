// design-studio のローカルサーバー。127.0.0.1 だけで待ち受け、台帳・見本帳・作業台の 3 つの画面が使う
// API を core の関数の上に薄く載せる。起動: node app/server.ts [--port n] [--no-browser]
// (1 行目に `design-studio app: http://127.0.0.1:<port>/` を出し、--no-browser が無ければブラウザを開く)
//
// API (応答は JSON。エラーは {"error": ..., "message": ...} と適切な状態コード):
//   GET  /                                    → app/index.html
//   GET  /app/<名前>.js                       → app/ の JS (名前は /^[a-z][a-z0-9-]*$/)
//   GET  /api/meta                            → {llmAvailable, styleGuide: "ok" | "missing", pageTypes, layouts, fontPairs}
//   GET  /api/catalog                         → {entries}
//   POST /api/catalog/enabled   {id, enabled} → {entry}
//   GET  /api/install-plan                    → {plan} (導入はしない)
//   GET  /api/styles                          → {styles}
//   GET  /api/treatments                      → {surfaces, motions}
//   GET  /api/motions/<id>/preview            → 動きの見本 1 件の HTML
//   GET  /api/themes/<styleId>                → {themeId, cssForPage, fontsUrl} (結果はメモリに保持)
//   GET  /api/gallery                         → {items: [{styleId, pageType, url}]}
//   GET  /gallery/<styleId>/<pageType>.html   → 見本の HTML
//   POST /api/directions  {brief, pageType, screenshot?, treatment?} → {directions, family}
//   POST /api/mix         {directions, points, fineTune?} → {mixed, direction, weights, snapped}
//   POST /api/render      {direction, family, mode?, treatment?} → {html, themeId, layout, surface, checks, failed}
//   POST /api/page        {brief, direction, pageType, treatment?} → {html}
//   POST /api/generate    {brief, direction, make, treatment?} → {make, html}
//   POST /api/tokens      {direction}         → {tailwind, json, css}
//   POST /api/projects    {project, page?: {pageType: {name, family}, html}, component?: {target, html}} → {project}
//   GET  /api/projects                        → {projects}
//   GET  /api/projects/<id>                   → {project}
//   GET  /api/projects/<id>/pages/<key>       → text/html
//   GET  /api/projects/<id>/components/<key>  → text/html
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief } from "../core/brief.ts";
import { listCatalog, setEnabled } from "../core/catalog.ts";
import { CliExit, EXIT_ACTION, EXIT_EXTERNAL, EXIT_INPUT } from "../core/cli-exit.ts";
import { generateComponent } from "../core/component-llm.ts";
import { validateComponentTarget } from "../core/component.ts";
import { applyFineTune, mixDirections, renderDirection, validateFineTune, validatePoints } from "../core/direction.ts";
import type { MixSnapped, MixWeights } from "../core/direction.ts";
import { planInstall } from "../core/installer.ts";
import { generateDirections, generatePage, llmAvailable, LlmError } from "../core/llm.ts";
import type { FontPair } from "../core/llm.ts";
import { hasPageCsp } from "../core/page-html.ts";
import { candidateOf, validatePageType } from "../core/page-type.ts";
import { galleryDir, styleGuideDir } from "../core/paths.ts";
import { listProjects, readComponent, readPage, readProject, saveProject } from "../core/project.ts";
import { findStyle, loadStyles, validateDirection } from "../core/styles.ts";
import { renderTheme, stripTailwindImport, tokensOf } from "../core/theme-bridge.ts";
import { findMotion, motionSampleHtml, treatmentListing, validateTreatment } from "../core/treatment.ts";
import { LAYOUTS, PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "../core/types.ts";
import type {
  BaseMode,
  Brief,
  ComponentTarget,
  Direction,
  FontMood,
  PageType,
  Seed,
  SkeletonFamily,
  Style,
  Treatment,
} from "../core/types.ts";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const INDEX_FILE = join(APP_DIR, "index.html");
const HTML_TYPE = "text/html; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
const JS_TYPE = "text/javascript; charset=utf-8";
// 保存したページの配信に付ける CSP。不透明なオリジンになり、スクリプトは動くがアプリの API には届かない
const PAGE_SANDBOX = "sandbox allow-scripts";
// ページの保存のキーの形 (core/project.ts の SLUG_RE と同じ)。形が合わないキーは無いものとして扱う
const PAGE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// 本文の上限。screenshot (5MB) を data URL で受ける /api/directions だけ大きくする
const BODY_LIMIT = 1024 * 1024;
const DIRECTIONS_LIMIT = 8 * 1024 * 1024;
const SCREENSHOT_LIMIT = 5 * 1024 * 1024;
// 上限を超えた本文の読み捨てを待つ時間。嘘の Content-Length で止まらないための線引き
const DRAIN_TIMEOUT_MS = 1000;

const PNG_PREFIX = "data:image/png;base64,";
const JPEG_PREFIX = "data:image/jpeg;base64,";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE_MODES: readonly BaseMode[] = ["light", "dark"];
const FONT_MOODS: readonly FontMood[] = ["geometric", "humanist", "rounded", "serif", "mincho", "tech"];

// 環境変数から決まる置き場は、要求のたびに core/paths.ts を通して引く (モジュールでは覚えない)

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 入力の誤り (400)。core の関数と同じ形にして、下の reportError がそのまま状態コードに変える
const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });
const styleGuideFailed = (message: string): CliExit => new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message });
const notFound = (): HttpError => new HttpError(404, { error: "not-found" });

// 経路ごとの失敗 (403 / 404 / 413 / 415)。応答をそのまま組み立てる
class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  close: boolean; // 応答のあとに接続を閉じるか (本文を読み捨てられなかったときだけ)
  constructor(status: number, body: Record<string, unknown>, close = false) {
    super(typeof body.message === "string" ? body.message : String(body.error));
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.close = close;
  }
}

type ThemeForSeed = { themeId: string; css: string; cssForPage: string; fontsUrl: string };
// /api/themes/<styleId> の結果。styleId ごとにメモリに保持する
const themeCache = new Map<string, ThemeForSeed>();

type RouteContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  env: NodeJS.ProcessEnv;
  path: string;
  params: string[]; // パスの正規表現の丸括弧に当たった部分 (decodeURIComponent 済み)
  body: Record<string, unknown>; // POST のときだけ読む
};
type Handler = (ctx: RouteContext) => Promise<void> | void;
// メソッドとパスの組 → 関数。上から順に見て、最初に合ったものを呼ぶ
type Route = { method: string; pattern: RegExp; limit: number; handle: Handler };

function sendRaw(
  res: http.ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  close = false,
  extraHeaders: Record<string, string> = {},
): void {
  const data = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, {
    ...extraHeaders,
    "Content-Type": type,
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(close ? { Connection: "close" } : {}),
  });
  res.end(data);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, close = false): void {
  sendRaw(res, status, JSON_TYPE, JSON.stringify(body), close);
}

// ファイルを返す。読めなければ 404
function serveFile(res: http.ServerResponse, path: string, type: string): void {
  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch {
    throw notFound();
  }
  sendRaw(res, 200, type, data);
}

type ReadBody = { tooLarge: boolean; text: string };

// 本文を上限まで読む。超えたら以降は読み捨て、end まで待って tooLarge にする (読み捨て終えてから 413 を返す)
function readBody(req: http.IncomingMessage, limit: number): Promise<ReadBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ tooLarge, text: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", reject);
  });
}

async function readJson(req: http.IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const body = await readBody(req, limit);
  if (body.tooLarge) throw new HttpError(413, { error: "too-large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    throw new HttpError(400, { error: "bad-json" });
  }
  if (!isRecord(parsed)) throw new HttpError(400, { error: "bad-json" });
  return parsed;
}

// Host と Origin が 127.0.0.1・localhost のどちらかを指しているか (外のページから叩かれないように)
function checkLocalRequest(req: http.IncomingMessage): void {
  const port = req.socket.localPort ?? 0;
  const hosts = [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`];
  if (!hosts.includes(String(req.headers.host ?? ""))) throw new HttpError(403, { error: "forbidden" });
  const origin = req.headers.origin;
  if (origin === undefined) return;
  if (!hosts.map((host) => `http://${host}`).includes(String(origin))) throw new HttpError(403, { error: "forbidden" });
}

// 本文を最後まで読み捨てる (end か close を待つ)。読み切れなかったら false を返して接続を閉じる
function drainBody(req: http.IncomingMessage, timeoutMs: number): Promise<boolean> {
  if (req.readableEnded || req.complete || req.destroyed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const onDrained = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const onFailed = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    req.on("end", onDrained);
    req.on("close", onDrained);
    req.on("error", onFailed);
    req.resume();
  });
}

// POST の前提 (Content-Type・本文の上限)。上限は Content-Length で先に判定する
async function checkPost(req: http.IncomingMessage, limit: number): Promise<void> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new HttpError(415, { error: "unsupported-media-type" });
  const length = Number(req.headers["content-length"]);
  if (!Number.isFinite(length) || length <= limit) return;
  // 本文は最後まで読み捨ててから 413 を返す (読み捨ての途中で接続を閉じると Windows では ECONNRESET になる)
  const drained = await drainBody(req, DRAIN_TIMEOUT_MS);
  throw new HttpError(413, { error: "too-large" }, !drained);
}

async function readPostBody(req: http.IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  await checkPost(req, limit);
  return readJson(req, limit);
}

// 外部入力の検証は手で書く (core の validate* と同じ形)

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw inputError(`${label} はオブジェクトで指定してください`);
  return value;
}

function bodyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

function bodyBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw inputError(`${label} は真偽値で指定してください`);
  return value;
}

// 骨組みの種類 (SKELETON_FAMILIES) のいずれかなら返す
function familyOrUndefined(value: unknown): SkeletonFamily | undefined {
  return typeof value === "string" ? SKELETON_FAMILIES.find((candidate) => candidate === value) : undefined;
}

function familyOf(value: unknown): SkeletonFamily {
  const family = familyOrUndefined(value);
  if (family === undefined) throw inputError(`family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
  return family;
}

// 画面の種類 (名前と骨組みの種類)。保存とページ作成では family まで要る (validatePageType の family は任意なので足りない分をここで止める)
function pageTypeWithFamily(value: unknown): PageType {
  const parsed = validatePageType(value);
  if (parsed.family === undefined) {
    throw inputError(`pageType.family は ${SKELETON_FAMILIES.join(" / ")} のいずれかで指定してください`);
  }
  return { name: parsed.name, family: parsed.family };
}

function modeOf(value: unknown): BaseMode | undefined {
  if (value === undefined || value === null) return undefined;
  const mode = typeof value === "string" ? BASE_MODES.find((candidate) => candidate === value) : undefined;
  if (mode === undefined) throw inputError(`mode は ${BASE_MODES.join(" / ")} のいずれかで指定してください`);
  return mode;
}

function directionsOf(value: unknown): Direction[] {
  if (!Array.isArray(value)) throw inputError("directions は配列で指定してください");
  if (value.length < 1 || value.length > 4) throw inputError(`directions は 1〜4 件の配列で指定してください (${String(value.length)} 件)`);
  return value.map((entry) => validateDirection(entry));
}

type Screenshot = { ext: string; data: Buffer };
type TempFile = { path: string; cleanup: () => void };

// data URL の screenshot。png か jpeg で 5MB まで
function screenshotOf(value: unknown): Screenshot | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw inputError("screenshot は data URL の文字列で指定してください");
  if (value.startsWith(PNG_PREFIX)) return screenshotData(value.slice(PNG_PREFIX.length), ".png");
  if (value.startsWith(JPEG_PREFIX)) return screenshotData(value.slice(JPEG_PREFIX.length), ".jpg");
  throw inputError("screenshot は data:image/png;base64, か data:image/jpeg;base64, で始めてください");
}

function screenshotData(encoded: string, ext: string): Screenshot {
  if (!BASE64_RE.test(encoded)) throw inputError("screenshot の base64 が不正です");
  const data = Buffer.from(encoded, "base64");
  if (data.length === 0) throw inputError("screenshot が空です");
  if (data.length > SCREENSHOT_LIMIT) throw inputError("screenshot は 5MB までです");
  return { ext, data };
}

// screenshot は一時ディレクトリに書いて渡し、使い終わったら消す
function writeScreenshot(shot: Screenshot): TempFile {
  const dir = mkdtempSync(join(tmpdir(), "design-studio-screen-"));
  const path = join(dir, `screenshot${shot.ext}`);
  try {
    writeFileSync(path, shot.data);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`screenshot を一時ファイルに書けません: ${errorMessage(e)}`);
  }
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// フォントの組は style-guide の data/fonts.json から読む

function fontString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw styleGuideFailed(`${label} は空でない文字列で指定してください`);
  return value;
}

function fontPairOf(entry: unknown, index: number): FontPair {
  const where = `data/fonts.json[${String(index)}]`;
  if (!isRecord(entry)) throw styleGuideFailed(`${where} はオブジェクトで指定してください`);
  const mood = FONT_MOODS.find((candidate) => candidate === entry.mood);
  if (mood === undefined) throw styleGuideFailed(`${where}.mood は ${FONT_MOODS.join(" / ")} のいずれかで指定してください`);
  if (typeof entry.japanese !== "boolean") throw styleGuideFailed(`${where}.japanese は真偽値で指定してください`);
  return {
    id: fontString(entry.id, `${where}.id`),
    heading: fontString(entry.heading, `${where}.heading`),
    body: fontString(entry.body, `${where}.body`),
    mono: fontString(entry.mono, `${where}.mono`),
    mood,
    japanese: entry.japanese,
  };
}

// 無ければ style-guide が無いのと同じ扱い (409)
function loadFontPairs(env: NodeJS.ProcessEnv): FontPair[] {
  const dir = styleGuideDir(env);
  const file = join(dir, "data", "fonts.json");
  if (!existsSync(file)) throw new CliExit(EXIT_ACTION, { error: "style-guide-missing", dir });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw styleGuideFailed(`data/fonts.json を読めません: ${errorMessage(e)}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) throw styleGuideFailed("data/fonts.json は 1 件以上のフォントの組の配列で指定してください");
  return raw.map((entry, index) => fontPairOf(entry, index));
}

// seed からテーマを作る。summary は seed の id に合うものを選び、無ければ先頭にする
async function themeOfSeed(seed: Seed, env: NodeJS.ProcessEnv): Promise<ThemeForSeed> {
  const theme = await renderTheme([seed], env);
  const summary = theme.summary.find((entry) => entry.id === seed.id) ?? theme.summary[0];
  if (summary === undefined) throw styleGuideFailed("summary が空です");
  return { themeId: seed.id, css: theme.css, cssForPage: stripTailwindImport(theme.css), fontsUrl: summary.fontsUrl };
}

// スタイルの seed からテーマを作る。styleId ごとにメモリに保持する (/api/themes と動きの見本で同じ道)
async function themeForStyle(style: Style, env: NodeJS.ProcessEnv): Promise<ThemeForSeed> {
  const cached = themeCache.get(style.id);
  if (cached !== undefined) return cached;
  const theme = await themeOfSeed(style.seed, env);
  themeCache.set(style.id, theme);
  return theme;
}

type ThemeResponse = { themeId: string; cssForPage: string; fontsUrl: string };

function themeResponse(theme: ThemeForSeed): ThemeResponse {
  return { themeId: theme.themeId, cssForPage: theme.cssForPage, fontsUrl: theme.fontsUrl };
}

function serveIndex(ctx: RouteContext): void {
  serveFile(ctx.res, INDEX_FILE, HTML_TYPE);
}

function serveAppJs(ctx: RouteContext): void {
  serveFile(ctx.res, join(APP_DIR, `${ctx.params[0] ?? ""}.js`), JS_TYPE);
}

function serveMeta(ctx: RouteContext): void {
  const dir = styleGuideDir(ctx.env);
  const styleGuide = existsSync(join(dir, "scripts", "pipeline.ts")) ? "ok" : "missing";
  sendJson(ctx.res, 200, {
    llmAvailable: llmAvailable(ctx.env),
    styleGuide,
    pageTypes: PAGE_TYPE_CANDIDATES,
    layouts: LAYOUTS,
    fontPairs: fontPairsOrEmpty(ctx.env),
  });
}

// フォントの組。style-guide が無い・読めないときは [] (作業台はフォントの選択を隠せる)
function fontPairsOrEmpty(env: NodeJS.ProcessEnv): FontPair[] {
  try {
    return loadFontPairs(env);
  } catch {
    return [];
  }
}

function serveCatalog(ctx: RouteContext): void {
  sendJson(ctx.res, 200, { entries: listCatalog(ctx.env) });
}

function serveInstallPlan(ctx: RouteContext): void {
  sendJson(ctx.res, 200, { plan: planInstall(ctx.env) });
}

function serveStyles(ctx: RouteContext): void {
  sendJson(ctx.res, 200, { styles: loadStyles() });
}

async function serveTheme(ctx: RouteContext): Promise<void> {
  const style = findStyle(ctx.params[0] ?? "");
  if (style === undefined) throw notFound();
  sendJson(ctx.res, 200, themeResponse(await themeForStyle(style, ctx.env)));
}

function serveTreatments(ctx: RouteContext): void {
  sendJson(ctx.res, 200, treatmentListing());
}

// 動きの見本 1 件を、見本帳の minimal のテーマで 1 ファイルの HTML にする
async function serveMotionPreview(ctx: RouteContext): Promise<void> {
  const sample = findMotion(ctx.params[0] ?? "");
  if (sample === undefined) throw notFound();
  const style = findStyle("minimal");
  if (style === undefined) throw notFound();
  const theme = await themeForStyle(style, ctx.env);
  const html = motionSampleHtml(sample, {
    themeId: style.seed.id,
    mode: style.seed.baseMode,
    cssForPage: theme.cssForPage,
    fontsUrl: theme.fontsUrl,
  });
  // 動きの見本も、保存したページと同じく不透明なオリジンで動かす (同じオリジンの /api を叩けない)
  sendRaw(ctx.res, 200, HTML_TYPE, html, false, { "Content-Security-Policy": PAGE_SANDBOX });
}

type GalleryItem = { styleId: string; pageType: SkeletonFamily; url: string };

// 一時の置き場 (DESIGN_STUDIO_GALLERY_DIR) に実際にある見本だけを返す
function galleryItems(env: NodeJS.ProcessEnv): GalleryItem[] {
  const dir = galleryDir(env);
  const items: GalleryItem[] = [];
  for (const style of loadStyles()) {
    for (const pageType of SKELETON_FAMILIES) {
      if (!existsSync(join(dir, style.id, `${pageType}.html`))) continue;
      items.push({ styleId: style.id, pageType, url: `/gallery/${style.id}/${pageType}.html` });
    }
  }
  return items;
}

function serveGallery(ctx: RouteContext): void {
  sendJson(ctx.res, 200, { items: galleryItems(ctx.env) });
}

function serveGalleryPage(ctx: RouteContext): void {
  const styleId = ctx.params[0] ?? "";
  const pageType = familyOrUndefined(ctx.params[1]);
  if (findStyle(styleId) === undefined || pageType === undefined) throw notFound();
  serveFile(ctx.res, join(galleryDir(ctx.env), styleId, `${pageType}.html`), HTML_TYPE);
}

function serveProjects(ctx: RouteContext): void {
  sendJson(ctx.res, 200, { projects: listProjects(ctx.env) });
}

function serveProject(ctx: RouteContext): void {
  const found = readProject(ctx.env, ctx.params[0] ?? "");
  if (found === null) throw notFound();
  sendJson(ctx.res, 200, { project: found.project });
}

function serveProjectPage(ctx: RouteContext): void {
  // キーの形が合わないときは、無いページとして扱う
  const key = ctx.params[1] ?? "";
  if (!PAGE_KEY_RE.test(key)) throw notFound();
  const html = readPage(ctx.env, ctx.params[0] ?? "", key);
  if (html === null) throw notFound();
  // LLM が書いたページなので、不透明なオリジンで動かす (同じオリジンの /api を叩けない)
  sendRaw(ctx.res, 200, HTML_TYPE, html, false, { "Content-Security-Policy": PAGE_SANDBOX });
}

function serveProjectComponent(ctx: RouteContext): void {
  // キーの形が合わないときは、無い部品として扱う
  const key = ctx.params[1] ?? "";
  if (!PAGE_KEY_RE.test(key)) throw notFound();
  const html = readComponent(ctx.env, ctx.params[0] ?? "", key);
  if (html === null) throw notFound();
  // LLM が書いた部品なので、ページと同じく不透明なオリジンで動かす (同じオリジンの /api を叩けない)
  sendRaw(ctx.res, 200, HTML_TYPE, html, false, { "Content-Security-Policy": PAGE_SANDBOX });
}

function postCatalogEnabled(ctx: RouteContext): void {
  const id = bodyString(ctx.body.id, "id");
  const enabled = bodyBoolean(ctx.body.enabled, "enabled");
  const found = listCatalog(ctx.env).find((entry) => entry.id === id);
  if (found === undefined) throw inputError(`知らない id です: ${id}`);
  setEnabled(ctx.env, id, enabled);
  sendJson(ctx.res, 200, { entry: { ...found, enabled } });
}

async function postDirections(ctx: RouteContext): Promise<void> {
  const brief = validateBrief(ctx.body.brief);
  const parsed = validatePageType(ctx.body.pageType);
  // 候補の名前なら、当てる骨組みの種類はその候補のものにする
  const candidate = candidateOf(parsed.name);
  const pageType = { name: parsed.name, family: candidate?.family ?? parsed.family };
  const screenshot = screenshotOf(ctx.body.screenshot);
  const treatment = validateTreatment(ctx.body.treatment);
  const fontPairs = loadFontPairs(ctx.env);
  const shot = screenshot === null ? null : writeScreenshot(screenshot);
  try {
    const result = await generateDirections({ brief, pageType, screenshotPath: shot?.path, fontPairs, treatment }, ctx.env);
    sendJson(ctx.res, 200, { directions: result.directions, family: result.family });
  } finally {
    shot?.cleanup();
  }
}

type MixedForClient = { mixed: Direction; direction: Direction; weights: MixWeights; snapped: MixSnapped };

// 点で混ぜ、微調整があれば重ねる。混ぜただけの mixed と、重ねた direction をいっしょに返す (/api/mix と /api/projects で同じ道)
function mixAndTune(directions: Direction[], points: unknown, fineTune: unknown): MixedForClient {
  const mixed = mixDirections(directions, validatePoints(points));
  const direction = fineTune === undefined ? mixed.direction : applyFineTune(mixed.direction, validateFineTune(fineTune));
  return { mixed: mixed.direction, direction, weights: mixed.weights, snapped: mixed.snapped };
}

function postMix(ctx: RouteContext): void {
  const directions = directionsOf(ctx.body.directions);
  sendJson(ctx.res, 200, mixAndTune(directions, ctx.body.points, ctx.body.fineTune));
}

async function postRender(ctx: RouteContext): Promise<void> {
  const direction = validateDirection(ctx.body.direction);
  const family = familyOf(ctx.body.family);
  const mode = modeOf(ctx.body.mode);
  const treatment = validateTreatment(ctx.body.treatment);
  sendJson(ctx.res, 200, await renderDirection({ direction, family, mode, surface: treatment.surface }, ctx.env));
}

// 生成に共通の入力 (依頼・方向性・表現)。/api/page と /api/generate で同じ順に検証する
type GenerateInput = { brief: Brief; direction: Direction; treatment: Treatment };

// ページの 1 ファイル。テーマは方向性の seed から作り、generatePage に渡す (/api/page と同じ道)
async function generatePageHtml(ctx: RouteContext, pageType: PageType, input: GenerateInput): Promise<string> {
  const theme = await themeOfSeed(input.direction.seed, ctx.env);
  return generatePage(
    {
      brief: input.brief,
      direction: input.direction,
      pageType,
      cssForPage: theme.cssForPage,
      fontsUrl: theme.fontsUrl,
      treatment: input.treatment,
    },
    ctx.env,
  );
}

// 部品帳・部品の 1 ファイル。ページと同じく方向性の seed からテーマを作る
async function generateComponentHtml(ctx: RouteContext, target: ComponentTarget, input: GenerateInput): Promise<string> {
  const theme = await themeOfSeed(input.direction.seed, ctx.env);
  return generateComponent(
    {
      brief: input.brief,
      direction: input.direction,
      target,
      cssForPage: theme.cssForPage,
      fontsUrl: theme.fontsUrl,
      treatment: input.treatment,
    },
    ctx.env,
  );
}

// 作るもの (make)。page はページの種類、部品の側は core の validateComponentTarget に任せる
type Make = { kind: "page"; pageType: PageType } | ComponentTarget;

function makeOf(value: unknown): Make {
  const make = recordOf(value, "make");
  if (make.kind === "page") return { kind: "page", pageType: pageTypeWithFamily(make.pageType) };
  if (make.kind === "component-sheet" || make.kind === "component") return validateComponentTarget(make);
  throw inputError("make.kind は page / component-sheet / component のいずれかで指定してください");
}

async function postGenerate(ctx: RouteContext): Promise<void> {
  const make = makeOf(ctx.body.make);
  const brief = validateBrief(ctx.body.brief);
  const direction = validateDirection(ctx.body.direction);
  const treatment = validateTreatment(ctx.body.treatment);
  const input = { brief, direction, treatment };
  const html = make.kind === "page" ? await generatePageHtml(ctx, make.pageType, input) : await generateComponentHtml(ctx, make, input);
  sendJson(ctx.res, 200, { make, html });
}

async function postPage(ctx: RouteContext): Promise<void> {
  const brief = validateBrief(ctx.body.brief);
  const direction = validateDirection(ctx.body.direction);
  const pageType = pageTypeWithFamily(ctx.body.pageType);
  const treatment = validateTreatment(ctx.body.treatment);
  const html = await generatePageHtml(ctx, pageType, { brief, direction, treatment });
  sendJson(ctx.res, 200, { html });
}

async function postTokens(ctx: RouteContext): Promise<void> {
  const direction = validateDirection(ctx.body.direction);
  sendJson(ctx.res, 200, await tokensOf(direction.seed, ctx.env));
}

// 版 2 の入力から、今の回の案 (編集があれば編集後) を取り出す。案の検証はここでする
function currentDirectionsOf(project: Record<string, unknown>): Direction[] {
  const rounds = project.rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) throw inputError("project.rounds は 1 件以上の配列で指定してください");
  const roundIndex = roundIndexOf(project.roundIndex, rounds.length);
  const round = recordOf(rounds[roundIndex], `project.rounds[${String(roundIndex)}]`);
  const drafts = round.drafts;
  if (!Array.isArray(drafts) || drafts.length < 1 || drafts.length > 4) {
    throw inputError(`project.rounds[${String(roundIndex)}].drafts は 1〜4 件の配列で指定してください`);
  }
  const edits = round.edits;
  if (!Array.isArray(edits) || edits.length !== drafts.length) {
    throw inputError(`project.rounds[${String(roundIndex)}].edits は drafts と同じ ${String(drafts.length)} 件の配列で指定してください`);
  }
  return drafts.map((draft, index) => validateDirection(edits[index] ?? draft));
}

// 今の回の添字。rounds の中の整数 (core/project.ts の validateRoundIndex と同じ)
function roundIndexOf(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= count) {
    throw inputError(`project.roundIndex は 0〜${String(count - 1)} の整数で指定してください`);
  }
  return value;
}

// 保存するページ (省略できる)。html は CSP の meta のある 1 ファイルだけ
function pageInputOf(value: unknown): { pageType: PageType; html: string } | undefined {
  if (value === undefined) return undefined;
  const page = recordOf(value, "page");
  const pageType = pageTypeWithFamily(page.pageType);
  const html = bodyString(page.html, "page.html");
  if (!hasPageCsp(html)) throw inputError("html に CSP の meta がありません");
  return { pageType, html };
}

// 保存する部品帳・部品 (省略できる)。html はページと同じく CSP の meta のある 1 ファイルだけ
function componentInputOf(value: unknown): { target: ComponentTarget; html: string } | undefined {
  if (value === undefined) return undefined;
  const component = recordOf(value, "component");
  const target = validateComponentTarget(component.target);
  const html = bodyString(component.html, "component.html");
  if (!hasPageCsp(html)) throw inputError("html に CSP の meta がありません");
  return { target, html };
}

async function postProjects(ctx: RouteContext): Promise<void> {
  const project = recordOf(ctx.body.project, "project");
  const page = pageInputOf(ctx.body.page);
  const component = componentInputOf(ctx.body.component);
  if (page !== undefined && component !== undefined) throw inputError("page と component は同時に指定できません");
  // 旧 pageType・html の最上位のキーは読まない。テーマの css は今の回を混ぜ直した方向性の seed から作る
  const mixed = mixAndTune(currentDirectionsOf(project), project.points, project.fineTune);
  const theme = await themeOfSeed(mixed.direction.seed, ctx.env);
  const saved = saveProject(ctx.env, { project, themeCss: theme.css, page, component });
  sendJson(ctx.res, 200, { project: saved });
}

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/$/, limit: BODY_LIMIT, handle: serveIndex },
  { method: "GET", pattern: /^\/app\/([a-z][a-z0-9-]*)\.js$/, limit: BODY_LIMIT, handle: serveAppJs },
  { method: "GET", pattern: /^\/api\/meta$/, limit: BODY_LIMIT, handle: serveMeta },
  { method: "GET", pattern: /^\/api\/catalog$/, limit: BODY_LIMIT, handle: serveCatalog },
  { method: "GET", pattern: /^\/api\/install-plan$/, limit: BODY_LIMIT, handle: serveInstallPlan },
  { method: "GET", pattern: /^\/api\/styles$/, limit: BODY_LIMIT, handle: serveStyles },
  { method: "GET", pattern: /^\/api\/treatments$/, limit: BODY_LIMIT, handle: serveTreatments },
  { method: "GET", pattern: /^\/api\/motions\/([a-z][a-z0-9-]*)\/preview$/, limit: BODY_LIMIT, handle: serveMotionPreview },
  { method: "GET", pattern: /^\/api\/themes\/([^/]+)$/, limit: BODY_LIMIT, handle: serveTheme },
  { method: "GET", pattern: /^\/api\/gallery$/, limit: BODY_LIMIT, handle: serveGallery },
  { method: "GET", pattern: /^\/gallery\/([^/]+)\/([^/]+)\.html$/, limit: BODY_LIMIT, handle: serveGalleryPage },
  { method: "GET", pattern: /^\/api\/projects$/, limit: BODY_LIMIT, handle: serveProjects },
  { method: "GET", pattern: /^\/api\/projects\/([^/]+)\/pages\/([^/]+)$/, limit: BODY_LIMIT, handle: serveProjectPage },
  { method: "GET", pattern: /^\/api\/projects\/([^/]+)\/components\/([^/]+)$/, limit: BODY_LIMIT, handle: serveProjectComponent },
  { method: "GET", pattern: /^\/api\/projects\/([^/]+)$/, limit: BODY_LIMIT, handle: serveProject },
  { method: "POST", pattern: /^\/api\/catalog\/enabled$/, limit: BODY_LIMIT, handle: postCatalogEnabled },
  { method: "POST", pattern: /^\/api\/directions$/, limit: DIRECTIONS_LIMIT, handle: postDirections },
  { method: "POST", pattern: /^\/api\/mix$/, limit: BODY_LIMIT, handle: postMix },
  { method: "POST", pattern: /^\/api\/render$/, limit: BODY_LIMIT, handle: postRender },
  { method: "POST", pattern: /^\/api\/page$/, limit: BODY_LIMIT, handle: postPage },
  { method: "POST", pattern: /^\/api\/generate$/, limit: BODY_LIMIT, handle: postGenerate },
  { method: "POST", pattern: /^\/api\/tokens$/, limit: BODY_LIMIT, handle: postTokens },
  { method: "POST", pattern: /^\/api\/projects$/, limit: BODY_LIMIT, handle: postProjects },
];

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  // Host / Origin の確認は、メソッドを問わずすべての要求で、経路の照合より前に行う
  checkLocalRequest(req);
  const method = req.method ?? "";
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  for (const candidate of ROUTES) {
    const match = candidate.method === method ? candidate.pattern.exec(path) : null;
    if (match === null) continue;
    const params = match.slice(1).map(decodeParam);
    const body = method === "POST" ? await readPostBody(req, candidate.limit) : {};
    await candidate.handle({ req, res, env, path, params, body });
    return;
  }
  throw notFound();
}

// core の CliExit は終了コード 1 → 400、2 → 409、3 → 502 に対応させ、payload をそのまま返す
function statusOfCliExit(code: number): number {
  if (code === EXIT_INPUT) return 400;
  if (code === EXIT_ACTION) return 409;
  if (code === EXIT_EXTERNAL) return 502;
  return 500;
}

function reportError(res: http.ServerResponse, e: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    res.destroy();
    return;
  }
  if (e instanceof HttpError) {
    sendJson(res, e.status, e.body, e.close);
    return;
  }
  if (e instanceof CliExit) {
    sendJson(res, statusOfCliExit(e.code), e.payload);
    return;
  }
  if (e instanceof LlmError) {
    sendJson(res, 502, { error: e.code, message: e.message });
    return;
  }
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  sendJson(res, 500, { error: "internal" });
}

export function createAppServer(env: NodeJS.ProcessEnv): http.Server {
  return http.createServer((req, res) => {
    route(req, res, env).catch((e: unknown) => reportError(res, e));
  });
}

// ブラウザを開く。開けなくてもサーバーは動かし続ける
function openBrowser(url: string): void {
  try {
    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // 開けなくても続ける
  }
}

function usageExit(message: string): never {
  console.error(message);
  process.exit(1);
}

function parsePort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usageExit("--port は 0〜65535 の整数で指定してください");
  return port;
}

// --port n と --no-browser だけを読む。知らない引数は usage
function readArgs(argv: string[]): { port: number; browser: boolean } {
  let port = 0;
  let browser = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      port = parsePort(argv[i + 1]);
      i += 1;
    } else if (arg === "--no-browser") {
      browser = false;
    } else {
      usageExit(`未知の引数です: ${String(arg)}`);
    }
  }
  return { port, browser };
}

function main(argv: string[]): void {
  const args = readArgs(argv);
  const server = createAppServer(process.env);
  server.listen(args.port, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : args.port;
    const url = `http://127.0.0.1:${String(port)}/`;
    console.log(`design-studio app: ${url}`);
    if (args.browser) openBrowser(url);
  });
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("server.ts")) main(process.argv.slice(2));
