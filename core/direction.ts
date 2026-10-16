// 方向性をパッドの点の重みで混ぜ (ADR 0003)、テーマを作って骨組みで描く。
// 混ぜる結果は決定的にする (同じ入力なら同じ id・同じ中身)。
// 外部入力の検証は style-guide の core/explicit.ts に倣って手で書く
import { createHash } from "node:crypto";
import { renderSkeleton } from "../skeletons/index.ts";
import { CliExit, EXIT_EXTERNAL, EXIT_INPUT } from "./cli-exit.ts";
import { validateDirection } from "./styles.ts";
import { renderTheme, stripTailwindImport } from "./theme-bridge.ts";
import type { CheckCounts, ThemeSummary } from "./theme-bridge.ts";
import { LAYOUTS, MIX_AXES, PAGE_TYPE_CANDIDATES, SKELETON_FAMILIES } from "./types.ts";
import type {
  BaseMode,
  Copy,
  Direction,
  FineTune,
  FontMood,
  Layouts,
  MixAxis,
  MixPoint,
  MixPoints,
  Seed,
  ShadowKind,
  SkeletonFamily,
} from "./types.ts";

const MIX_ID_PREFIX = "mix-";
const FINE_TUNE_ID_PREFIX = "tune-";
// タイトルに入れる画面の種類の名前。候補の表 (PAGE_TYPE_CANDIDATES) から引く
function titleNameOf(family: SkeletonFamily): string {
  return PAGE_TYPE_CANDIDATES.find((candidate) => candidate.family === family)?.name ?? family;
}

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ===== 微調整の検証に使う範囲 (core/styles.ts の Seed の検証と同じ) =====

const HUE_MAX = 360;
const CHROMA_MAX = 0.4;
const CONTRAST_MIN = 1;
const CONTRAST_MAX = 5;
const RADIUS_MIN = 0;
const RADIUS_MAX = 48;
const SPACING_MIN = 0.5;
const SPACING_MAX = 2;
const BASE_MODES: readonly BaseMode[] = ["light", "dark"];
const FONT_MOODS: readonly FontMood[] = ["geometric", "humanist", "rounded", "serif", "mincho", "tech"];
const SHADOWS: readonly ShadowKind[] = ["none", "soft", "hard"];

// ===== パッドの点と混ぜる計算 (ADR 0003) =====

// パッドの 4 隅。案は A=(0,0) 左上・B=(1,0) 右上・C=(0,1) 左下・D=(1,1) 右下に置く。案は 1〜4 件
const SLOT_MAX = 4;

// 円周平均のベクトルが打ち消しある (この長さ未満) ときは、重みが一番大きい案の色相で代用する
const VECTOR_EPS = 1e-9;
const DEG = Math.PI / 180;

type Weights4 = [number, number, number, number];
// 4 隅に置いた案と重み (A〜D の順)
type AxisSlot = { direction: Direction; weight: number };
type AxisSlots = [AxisSlot, AxisSlot, AxisSlot, AxisSlot];
type Slots4 = [Direction, Direction, Direction, Direction];
// 軸ごとに吸着した案 (copy はその添字)
type Chosen = {
  color: AxisSlot;
  font: AxisSlot;
  shape: AxisSlot;
  layout: AxisSlot;
  copy: { direction: Direction; index: number };
};
// 値と重みの組。平均は重みの合計が 1 なので割らない
type WeightedValue = { value: number; weight: number };

// 吸着に使った案の添字 (0〜3)
export type MixSnapped = { color: number; font: number; shape: number; layout: number; copy: number };
// 各軸の 4 隅の重み
export type MixWeights = Record<MixAxis, Weights4>;
export type MixResult = { direction: Direction; weights: MixWeights; snapped: MixSnapped };

/** 4 軸の点を検証し、小数 3 桁に丸めて返す */
export function validatePoints(x: unknown): MixPoints {
  if (!isRecord(x)) throw inputError("points はオブジェクトで指定してください");
  return {
    color: pointOf(x.color, "points.color"),
    font: pointOf(x.font, "points.font"),
    shape: pointOf(x.shape, "points.shape"),
    layout: pointOf(x.layout, "points.layout"),
  };
}

// 1 軸の点。x, y は 0〜1 の有限の数
function pointOf(value: unknown, label: string): MixPoint {
  if (!isRecord(value)) throw inputError(`${label} は {x, y} のオブジェクトで指定してください`);
  return { x: unitNumber(value.x, `${label}.x`), y: unitNumber(value.y, `${label}.y`) };
}

function unitNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw inputError(`${label} は 0〜1 の数値で指定してください`);
  }
  return roundOf(value, 3);
}

// 小数 digits 桁に丸める (−0 は 0 にそろえる)
function roundOf(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** パッドの点から 4 隅の双一次の重み。A=(1-x)(1-y)・B=x(1-y)・C=(1-x)y・D=xy */
export function padWeights(point: MixPoint): Weights4 {
  return [(1 - point.x) * (1 - point.y), point.x * (1 - point.y), (1 - point.x) * point.y, point.x * point.y];
}

/** パッドの点の重みで 4 案を混ぜ、吸着の添字といっしょに返す。案は 1〜4 件で、足りない隅は先頭の案で埋める */
export function mixDirections(directions: Direction[], points: MixPoints): MixResult {
  const axes: Record<MixAxis, AxisSlots> = {
    color: axisSlotsOf(directions, points.color),
    font: axisSlotsOf(directions, points.font),
    shape: axisSlotsOf(directions, points.shape),
    layout: axisSlotsOf(directions, points.layout),
  };
  const chosen: Chosen = {
    color: heaviest(axes.color),
    font: heaviest(axes.font),
    shape: heaviest(axes.shape),
    layout: heaviest(axes.layout),
    copy: copyChosenOf(axes),
  };
  const id = mixIdOf(points);
  const direction: Direction = {
    id,
    name: `${chosen.color.direction.name} ベースのミックス`,
    rationale: rationaleOf(chosen),
    seed: mixedSeedOf(axes, chosen, id),
    layouts: { ...chosen.layout.direction.layouts },
    copy: chosen.copy.direction.copy,
  };
  return {
    direction,
    weights: weightsOf(axes),
    snapped: snappedOf(axes, chosen),
  };
}

// 案を A〜D の 4 隅に置く。足りない隅は先頭の案で埋める
function slotOf(directions: Direction[]): Slots4 {
  const [first] = directions;
  if (first === undefined) throw inputError("directions は 1〜4 件の配列で指定してください");
  if (directions.length > SLOT_MAX) {
    throw inputError(`directions は 1〜4 件の配列で指定してください (${String(directions.length)} 件)`);
  }
  return [directions[0] ?? first, directions[1] ?? first, directions[2] ?? first, directions[3] ?? first];
}

// 軸ごとに、4 隅に置いた案と重みの組を作る
function axisSlotsOf(directions: Direction[], point: MixPoint): AxisSlots {
  const slots = slotOf(directions);
  const [wa, wb, wc, wd] = padWeights(point);
  return [
    { direction: slots[0], weight: wa },
    { direction: slots[1], weight: wb },
    { direction: slots[2], weight: wc },
    { direction: slots[3], weight: wd },
  ];
}

// 重みを比べる桁。点は小数 3 桁に丸めてあるので、重みと 4 軸の合計は小数 6 桁より粗い刻みで動く。
// それでも浮動小数では同じ重みのはずの値が下の桁 (1e-16 前後) だけずれるので、丸めてから比べる
const WEIGHT_PRECISION = 9;

// a の重みのほうが b より確実に大きいか。同点なら false (呼び出し元は先の案のままにする)
function heavierThan(a: number, b: number): boolean {
  return roundOf(a, WEIGHT_PRECISION) > roundOf(b, WEIGHT_PRECISION);
}

// 一番重い隅の案。同じ重みなら A → B → C → D の順で先のもの
function heaviest(axis: AxisSlots): AxisSlot {
  let best: AxisSlot = axis[0];
  for (const entry of axis) {
    if (heavierThan(entry.weight, best.weight)) best = entry;
  }
  return best;
}

// 一番大きい重みの添字。同じ重みなら先の添字
function heaviestIndex(weights: Weights4): number {
  const [w0, w1, w2, w3] = weights;
  let best = 0;
  let weight = w0;
  if (heavierThan(w1, weight)) {
    best = 1;
    weight = w1;
  }
  if (heavierThan(w2, weight)) {
    best = 2;
    weight = w2;
  }
  if (heavierThan(w3, weight)) {
    best = 3;
    weight = w3;
  }
  return best;
}

// 吸着に使った案の添字。copy は 4 軸の合計で決めるので案と添字を受け取る
function snappedOf(axes: Record<MixAxis, AxisSlots>, chosen: Chosen): MixSnapped {
  return {
    color: snappedIndexOf(axes.color, chosen.color),
    font: snappedIndexOf(axes.font, chosen.font),
    shape: snappedIndexOf(axes.shape, chosen.shape),
    layout: snappedIndexOf(axes.layout, chosen.layout),
    copy: chosen.copy.index,
  };
}

// 案の添字 (0〜3)。同じ隅の項目は同じオブジェクトなので一致で探す
function snappedIndexOf(axis: AxisSlots, slot: AxisSlot): number {
  return axis.findIndex((entry) => entry === slot);
}

// copy は 4 軸の重みの合計が一番大きい案 (同じなら A 優先)。4 軸とも同じ隅に同じ案が置いてある
function copyChosenOf(axes: Record<MixAxis, AxisSlots>): { direction: Direction; index: number } {
  const sums: Weights4 = [
    axes.color[0].weight + axes.font[0].weight + axes.shape[0].weight + axes.layout[0].weight,
    axes.color[1].weight + axes.font[1].weight + axes.shape[1].weight + axes.layout[1].weight,
    axes.color[2].weight + axes.font[2].weight + axes.shape[2].weight + axes.layout[2].weight,
    axes.color[3].weight + axes.font[3].weight + axes.shape[3].weight + axes.layout[3].weight,
  ];
  const index = heaviestIndex(sums);
  const slots = axes.color;
  const direction =
    index === 0 ? slots[0].direction : index === 1 ? slots[1].direction : index === 2 ? slots[2].direction : slots[3].direction;
  return { direction, index };
}

// 軸ごとの重みの組
function weightsOf(axes: Record<MixAxis, AxisSlots>): MixWeights {
  return {
    color: [axes.color[0].weight, axes.color[1].weight, axes.color[2].weight, axes.color[3].weight],
    font: [axes.font[0].weight, axes.font[1].weight, axes.font[2].weight, axes.font[3].weight],
    shape: [axes.shape[0].weight, axes.shape[1].weight, axes.shape[2].weight, axes.shape[3].weight],
    layout: [axes.layout[0].weight, axes.layout[1].weight, axes.layout[2].weight, axes.layout[3].weight],
  };
}

// 軸ごとに吸着した案の名前を並べた 1 文 (今の書き方に倣う)
function rationaleOf(chosen: Chosen): string {
  return `色は「${chosen.color.direction.name}」、フォントは「${chosen.font.direction.name}」、形は「${chosen.shape.direction.name}」、配置は「${chosen.layout.direction.name}」から取ったミックス。`;
}

// 混ぜた seed。色相・彩度・コントラスト・角丸・余白は重みで平均し、ライト/ダーク・雰囲気・フォント・影は吸着
function mixedSeedOf(axes: Record<MixAxis, AxisSlots>, chosen: Chosen, id: string): Seed {
  return {
    id,
    name: `${chosen.color.direction.name} ベースのミックス`,
    tone: chosen.color.direction.seed.tone,
    baseMode: chosen.color.direction.seed.baseMode,
    color: mixedColorOf(axes.color),
    shape: mixedShapeOf(axes.shape, chosen.shape.direction.seed.shape.shadow),
    font: { ...chosen.font.direction.seed.font },
  };
}

// 色の軸。brandHue・neutralHue は円周上の平均、chroma・contrast は重み付き平均、accentHue は null の案を外した平均
function mixedColorOf(axis: AxisSlots): Seed["color"] {
  const brandChroma = entriesOf(axis, (seed) => seed.color.brandChroma);
  const neutralChroma = entriesOf(axis, (seed) => seed.color.neutralChroma);
  const contrast = entriesOf(axis, (seed) => seed.color.contrast);
  return {
    brandHue: roundHue(circularHueOf(entriesOf(axis, (seed) => seed.color.brandHue))),
    brandChroma: roundOf(weightedMeanOf(brandChroma), 4),
    accentHue: accentHueOf(axis),
    neutralHue: roundHue(circularHueOf(entriesOf(axis, (seed) => seed.color.neutralHue))),
    neutralChroma: roundOf(weightedMeanOf(neutralChroma), 4),
    contrast: roundOf(weightedMeanOf(contrast), 2),
  };
}

// 形の軸。radiusPx・spacingScale は重み付き平均、shadow は吸着
function mixedShapeOf(axis: AxisSlots, shadow: ShadowKind): Seed["shape"] {
  return {
    radiusPx: roundOf(weightedMeanOf(entriesOf(axis, (seed) => seed.shape.radiusPx)), 1),
    spacingScale: roundOf(weightedMeanOf(entriesOf(axis, (seed) => seed.shape.spacingScale)), 2),
    shadow,
  };
}

// 軸の各隅の seed から値を取り、重みといっしょに並べる
function entriesOf(axis: AxisSlots, valueOf: (seed: Seed) => number): WeightedValue[] {
  return axis.map((slot) => ({ value: valueOf(slot.direction.seed), weight: slot.weight }));
}

// 重み付き平均 (重みの合計は 1 なので割らない)
function weightedMeanOf(entries: WeightedValue[]): number {
  return entries.reduce((sum, entry) => sum + entry.weight * entry.value, 0);
}

// 重み付きの円周上の平均 (0〜360)。ベクトルが打ち消しあるときは重みが一番大きい項目の色相
function circularHueOf(entries: WeightedValue[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const entry of entries) {
    sinSum += entry.weight * Math.sin(entry.value * DEG);
    cosSum += entry.weight * Math.cos(entry.value * DEG);
  }
  if (Math.hypot(sinSum, cosSum) < VECTOR_EPS) {
    let best: WeightedValue | undefined;
    for (const entry of entries) {
      if (best === undefined || entry.weight > best.weight) best = entry;
    }
    if (best === undefined) return 0; // entries は必ず 1 件以上 (呼び出し元が保証する)
    return best.value;
  }
  return (Math.atan2(sinSum, cosSum) / DEG + 360) % 360;
}

// accentHue は null の案を外して円周平均。外したあとの重みの合計が 0 なら null
function accentHueOf(axis: AxisSlots): number | null {
  const entries = axis.flatMap<WeightedValue>((slot) => {
    const accent = slot.direction.seed.color.accentHue;
    return accent === null ? [] : [{ value: accent, weight: slot.weight }];
  });
  const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (weight === 0) return null;
  return roundHue(circularHueOf(entries));
}

// 色相は小数 1 桁 (360 になったら 0 に折り返す)
function roundHue(value: number): number {
  const rounded = roundOf(value, 1);
  return rounded >= 360 ? rounded - 360 : rounded;
}

// 丸めた点を color,font,shape,layout の順に並べた文字列
function pointsKeyOf(points: MixPoints): string {
  const order = [points.color, points.font, points.shape, points.layout];
  return order.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(",");
}

// 点の組から決まる id。同じ点なら同じ id (SHA-256 の先頭 12 桁)
function mixIdOf(points: MixPoints): string {
  const digest = createHash("sha256").update(pointsKeyOf(points)).digest("hex");
  return `${MIX_ID_PREFIX}${digest.slice(0, 12)}`;
}

// ===== 微調整 =====

// fineTune の各キーの読み方。知らないキーはエラーにする
type TuneWriter = (fineTune: FineTune, value: unknown) => void;
const FINE_TUNE_WRITERS: Record<string, TuneWriter> = {
  brandHue: (fineTune, value) => {
    fineTune.brandHue = hueValueOf(value, "fineTune.brandHue");
  },
  brandChroma: (fineTune, value) => {
    fineTune.brandChroma = numRangeOf(value, 0, CHROMA_MAX, "fineTune.brandChroma");
  },
  accentHue: (fineTune, value) => {
    fineTune.accentHue = nullableHueOf(value, "fineTune.accentHue");
  },
  contrast: (fineTune, value) => {
    fineTune.contrast = numRangeOf(value, CONTRAST_MIN, CONTRAST_MAX, "fineTune.contrast");
  },
  radiusPx: (fineTune, value) => {
    fineTune.radiusPx = numRangeOf(value, RADIUS_MIN, RADIUS_MAX, "fineTune.radiusPx");
  },
  spacingScale: (fineTune, value) => {
    fineTune.spacingScale = numRangeOf(value, SPACING_MIN, SPACING_MAX, "fineTune.spacingScale");
  },
  shadow: (fineTune, value) => {
    fineTune.shadow = oneOf(value, SHADOWS, "fineTune.shadow");
  },
  baseMode: (fineTune, value) => {
    fineTune.baseMode = oneOf(value, BASE_MODES, "fineTune.baseMode");
  },
  font: (fineTune, value) => {
    fineTune.font = fontOf(value);
  },
  layouts: (fineTune, value) => {
    fineTune.layouts = layoutsOf(value);
  },
  copy: (fineTune, value) => {
    fineTune.copy = copyOf(value);
  },
};

/** 微調整を検証して返す。範囲は core/styles.ts の Seed の検証と同じで、知らないキーはエラー */
export function validateFineTune(x: unknown): FineTune {
  if (!isRecord(x)) throw inputError("fineTune はオブジェクトで指定してください");
  const fineTune: FineTune = {};
  for (const key of Object.keys(x)) {
    // 自分のキーだけで引く。プロトタイプをたどると constructor や valueOf の名前が writer に見えてしまう
    const writer = Object.hasOwn(FINE_TUNE_WRITERS, key) ? FINE_TUNE_WRITERS[key] : undefined;
    if (writer === undefined) throw inputError(`fineTune に知らないキーがあります: ${key}`);
    writer(fineTune, x[key]);
  }
  return fineTune;
}

/** 微調整を方向性に重ねる。空なら渡されたままで、上書きしたら id と seed.id を tune- 付きの値に変える */
export function applyFineTune(direction: Direction, fineTune: FineTune): Direction {
  if (Object.keys(fineTune).length === 0) return direction;
  const id = tuneIdOf(direction.id, fineTune);
  return validateDirection({
    ...direction,
    id,
    seed: {
      ...direction.seed,
      id,
      baseMode: fineTune.baseMode ?? direction.seed.baseMode,
      color: tunedColorOf(direction.seed.color, fineTune),
      shape: tunedShapeOf(direction.seed.shape, fineTune),
      font: fineTune.font ?? direction.seed.font,
    },
    layouts: tunedLayoutsOf(direction.layouts, fineTune.layouts),
    copy: fineTune.copy ?? direction.copy,
  });
}

// fineTune のキーが無い項目は混ぜた値を残す
function tunedColorOf(base: Seed["color"], fineTune: FineTune): Seed["color"] {
  return {
    brandHue: fineTune.brandHue ?? base.brandHue,
    brandChroma: fineTune.brandChroma ?? base.brandChroma,
    accentHue: fineTune.accentHue === undefined ? base.accentHue : fineTune.accentHue,
    neutralHue: base.neutralHue,
    neutralChroma: base.neutralChroma,
    contrast: fineTune.contrast ?? base.contrast,
  };
}

function tunedShapeOf(base: Seed["shape"], fineTune: FineTune): Seed["shape"] {
  return {
    radiusPx: fineTune.radiusPx ?? base.radiusPx,
    spacingScale: fineTune.spacingScale ?? base.spacingScale,
    shadow: fineTune.shadow ?? base.shadow,
  };
}

// 配置の型は部分的に重ねる (書いてキーだけが混ぜた値)
function tunedLayoutsOf(base: Layouts, patch: Partial<Layouts> | undefined): Layouts {
  return patch === undefined ? base : { ...base, ...patch };
}

// tune- + (元の id と、キーを並べ替えた fineTune の JSON をつないだ文字列) の SHA-256 の先頭 12 桁
function tuneIdOf(baseId: string, fineTune: FineTune): string {
  const digest = createHash("sha256")
    .update(baseId + canonicalJsonOf(fineTune))
    .digest("hex");
  return `${FINE_TUNE_ID_PREFIX}${digest.slice(0, 12)}`;
}

// キーを並べ替えた JSON。ネストの順番が違っても同じ文字列になる
function canonicalJsonOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonOf).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonOf(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// ===== 微調整の各項目の検証 =====

// 有限の数値
function numValueOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw inputError(`${label} は数値で指定してください`);
  return value;
}

// min〜max に収まる数値
function numRangeOf(value: unknown, min: number, max: number, label: string): number {
  const n = numValueOf(value, label);
  if (n < min || n > max) throw inputError(`${label} は ${min}〜${max} の範囲で指定してください`);
  return n;
}

// 0 以上 360 未満の色相
function hueValueOf(value: unknown, label: string): number {
  const n = numValueOf(value, label);
  if (n < 0 || n >= HUE_MAX) throw inputError(`${label} は 0 以上 ${HUE_MAX} 未満で指定してください`);
  return n;
}

// 色相または null。null のときは混ぜた値の代わりにアクセントを消す
function nullableHueOf(value: unknown, label: string): number | null {
  if (value === null) return null;
  return hueValueOf(value, label);
}

// 列挙のいずれか
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string") {
    const found = allowed.find((candidate) => candidate === value);
    if (found !== undefined) return found;
  }
  throw inputError(`${label} は ${allowed.join(" / ")} のいずれかで指定してください`);
}

// trim して空にならない文字列
function textOf(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw inputError(`${label} は空でない文字列で指定してください`);
  return value;
}

// seed.font と同じ形 (まるごと入れ替わる)。pairId は任意
function fontOf(x: unknown, label = "fineTune.font"): Seed["font"] {
  if (!isRecord(x)) throw inputError(`${label} はオブジェクトで指定してください`);
  const pairId = x.pairId === undefined ? undefined : textOf(x.pairId, `${label}.pairId`);
  return {
    mood: oneOf(x.mood, FONT_MOODS, `${label}.mood`),
    heading: textOf(x.heading, `${label}.heading`),
    body: textOf(x.body, `${label}.body`),
    mono: textOf(x.mono, `${label}.mono`),
    ...(pairId === undefined ? {} : { pairId }),
  };
}

// 配置の型は部分的に重ねる。骨組みの種類でないキーはエラー
function layoutsOf(x: unknown, label = "fineTune.layouts"): Partial<Layouts> {
  if (!isRecord(x)) throw inputError(`${label} はオブジェクトで指定してください`);
  const out: Partial<Layouts> = {};
  for (const key of Object.keys(x)) {
    const family = SKELETON_FAMILIES.find((candidate) => candidate === key);
    if (family === undefined) throw inputError(`${label} に知らないキーがあります: ${key}`);
    Object.assign(out, { [family]: oneOf(x[key], LAYOUTS[family], `${label}.${family}`) });
  }
  return out;
}

// 骨組みに差し込む文章。items は 3〜6 件
function copyOf(x: unknown, label = "fineTune.copy"): Copy {
  if (!isRecord(x)) throw inputError(`${label} はオブジェクトで指定してください`);
  const items = x.items;
  if (!Array.isArray(items) || items.length < 3 || items.length > 6) {
    throw inputError(`${label}.items は 3〜6 件の配列で指定してください`);
  }
  return {
    brand: textOf(x.brand, `${label}.brand`),
    tagline: textOf(x.tagline, `${label}.tagline`),
    headline: textOf(x.headline, `${label}.headline`),
    lead: textOf(x.lead, `${label}.lead`),
    cta: textOf(x.cta, `${label}.cta`),
    items: items.map((item, index) => copyItemOf(item, index, label)),
  };
}

function copyItemOf(x: unknown, index: number, label: string): { title: string; body: string } {
  if (!isRecord(x)) throw inputError(`${label}.items[${String(index)}] はオブジェクトで指定してください`);
  return {
    title: textOf(x.title, `${label}.items[${String(index)}].title`),
    body: textOf(x.body, `${label}.items[${String(index)}].body`),
  };
}

// ===== 描く =====

export type RenderDirectionInput = { direction: Direction; family: SkeletonFamily; mode?: BaseMode };
export type RenderDirectionResult = {
  html: string;
  themeId: string;
  layout: string;
  checks: Record<BaseMode, CheckCounts>;
  failed: number;
};

// style-guide の summary から種の id のものを選ぶ。無ければ先頭。それも無ければ外部の失敗
function summaryOf(summary: ThemeSummary[], seedId: string): ThemeSummary {
  const found = summary.find((entry) => entry.id === seedId) ?? summary[0];
  if (found === undefined) throw new CliExit(EXIT_EXTERNAL, { error: "style-guide-failed", message: "summary が空です" });
  return found;
}

/** 方向性と画面の種類からテーマを作り、骨組みで 1 枚の HTML を描く。mode を省くと seed.baseMode */
export async function renderDirection(input: RenderDirectionInput, env: NodeJS.ProcessEnv): Promise<RenderDirectionResult> {
  const { direction, family } = input;
  const mode = input.mode ?? direction.seed.baseMode;
  const theme = await renderTheme([direction.seed], env);
  const summary = summaryOf(theme.summary, direction.seed.id);
  const layout = direction.layouts[family];
  const html = renderSkeleton({
    family,
    layout,
    copy: direction.copy,
    mode,
    themeId: direction.seed.id,
    cssForPage: stripTailwindImport(theme.css),
    fontsUrl: summary.fontsUrl,
    title: `${direction.name}の${titleNameOf(family)}`,
  });
  return { html, themeId: direction.seed.id, layout, checks: summary.checks, failed: theme.failed };
}
