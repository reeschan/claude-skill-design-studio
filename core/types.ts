// style-guide の core/types.ts の Seed と同じ形を写す (リポジトリをまたいで import しない)
export type BaseMode = "light" | "dark";
export type FontMood = "geometric" | "humanist" | "rounded" | "serif" | "mincho" | "tech";
export type ShadowKind = "none" | "soft" | "hard";
export type Seed = {
  id: string;
  name: string;
  tone: string;
  baseMode: BaseMode;
  color: { brandHue: number; brandChroma: number; accentHue: number | null; neutralHue: number; neutralChroma: number; contrast: number };
  shape: { radiusPx: number; spacingScale: number; shadow: ShadowKind };
  font: { mood: FontMood; heading: string; body: string; mono: string; pairId?: string };
};

// 骨組みの種類 (骨組みを用意してある画面の種類)。LAYOUTS は種類ごとの配置の型 (3 つずつ)
export const SKELETON_FAMILIES = ["lp", "dashboard", "blog", "pricing", "product", "portfolio", "settings"] as const;
export type SkeletonFamily = (typeof SKELETON_FAMILIES)[number];
export const LAYOUTS = {
  lp: ["centered", "split", "fullbleed"],
  dashboard: ["sidebar", "topnav", "cards"],
  blog: ["classic", "magazine", "minimal"],
  pricing: ["tiers", "table", "spotlight"],
  product: ["split", "gallery", "story"],
  portfolio: ["grid", "list", "showcase"],
  settings: ["sidebar", "tabs", "stacked"],
} as const;
export type Layouts = { [F in SkeletonFamily]: (typeof LAYOUTS)[F][number] };

// 画面の種類 = 利用者に見せる名前と、当てた骨組みの種類の組
export type PageType = { name: string; family: SkeletonFamily };
// 候補の 7 つ (この順で並べる)
export const PAGE_TYPE_CANDIDATES: readonly PageType[] = [
  { name: "LP", family: "lp" },
  { name: "ダッシュボード", family: "dashboard" },
  { name: "ブログ記事", family: "blog" },
  { name: "料金ページ", family: "pricing" },
  { name: "商品詳細", family: "product" },
  { name: "ポートフォリオ", family: "portfolio" },
  { name: "設定画面", family: "settings" },
];

// 部品の候補 (部品帳に並ぶ 10 個と同じ。並びもこのとおり)
export type ComponentCandidate = { id: string; name: string };
export const COMPONENT_CANDIDATES: readonly ComponentCandidate[] = [
  { id: "button", name: "ボタン" },
  { id: "input", name: "入力欄" }, // テキスト・選択・チェック・スイッチ
  { id: "card", name: "カード" },
  { id: "nav", name: "ヘッダーのナビ" },
  { id: "tabs", name: "タブ" },
  { id: "badge", name: "バッジ/タグ" },
  { id: "modal", name: "モーダル" },
  { id: "toast", name: "トースト" },
  { id: "table", name: "表" },
  { id: "pricing-card", name: "料金カード" },
];

// 作るもののうち部品の側。ページは PageType で表す。デザインガイドは第 4 段で足す
export type ComponentTarget = { kind: "component-sheet" } | { kind: "component"; name: string };

// 依頼。what は必須 (trim 後 1〜2000 文字)、ほかは任意 (無ければ空文字、trim 後 0〜500 文字)
export type Brief = { what: string; mood: string; audience: string; mustHave: string };

export const MIX_AXES = ["color", "font", "shape", "layout"] as const;
export type MixAxis = (typeof MIX_AXES)[number];
// パッドの点。x, y は 0〜1。隅は A=(0,0) 左上・B=(1,0) 右上・C=(0,1) 左下・D=(1,1) 右下
export type MixPoint = { x: number; y: number };
export type MixPoints = Record<MixAxis, MixPoint>;
// 微調整。項目ごとに有無を持つ (キーが無い = 混ぜた値のまま)
export type FineTune = {
  brandHue?: number;
  brandChroma?: number;
  accentHue?: number | null;
  contrast?: number;
  radiusPx?: number;
  spacingScale?: number;
  shadow?: ShadowKind;
  baseMode?: BaseMode;
  font?: Seed["font"];
  layouts?: Partial<Layouts>;
  copy?: Copy;
};

// 骨組みに差し込む文章。items は 3〜6 件
export type Copy = {
  brand: string;
  tagline: string;
  headline: string;
  lead: string;
  cta: string;
  items: { title: string; body: string }[];
};

export type Direction = { id: string; name: string; rationale: string; seed: Seed; layouts: Layouts; copy: Copy };
export type Style = Direction & { description: string }; // 見本帳のスタイル。id は seed.id と同じ

export const STAGES = ["theme", "page", "review", "polish"] as const;
export type Stage = (typeof STAGES)[number];
export type CatalogSource =
  | { type: "github"; repo: string; path: string; ref: string } // repo は "owner/name"、path はリポジトリ内のスキルのディレクトリ、ref はコミット SHA (40 桁)
  | { type: "plugin"; plugin: string; marketplace: string }; // 例 plugin "design"
export type CatalogEntry = {
  id: string; // スキル名。~/.claude/skills/<id> やプラグインの skills/<id> の名前
  name: string;
  stage: Stage;
  role: string;
  roleLabel: string;
  isDefault: boolean;
  source: CatalogSource;
  prerequisites: { label: string; command: string }[]; // PC 全体に効く前提。自動では実行しない
  target: "any" | "react";
  license: string;
  summary: string;
  exampleRequest: string;
  exampleOutput: string;
  notes: string[];
  invokeFlags: string[]; // 呼ぶときに既定で付ける引数 (react-doctor は ["--no-telemetry"])
};
export type CatalogView = CatalogEntry & { installed: boolean; enabled: boolean; origin: "bundled" | "local" };

// プロジェクトの 1 回。drafts は 1〜4 件の原案で、edits は同じ長さ (原案は書き換えない。null は原案のまま)
export type Round = { drafts: Direction[]; edits: (Direction | null)[] };
// 表現の動きの強さ (この 3 つで固定)
export const MOTION_LEVELS = ["none", "subtle", "animated"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];
// 表現 = 面と動きの組。surface は data/surfaces.json の id (コードを変えずに面を足せるよう、型は string)。
// motionSamples は動きの見本の id の並び (0〜4 件、重複なし)。motion が animated のときだけ中身を持ち、それ以外は []
export type Treatment = { surface: string; motion: MotionLevel; motionSamples: string[] };
// 保存した 1 件。kind は作ったもの (ページ・部品帳・部品)。treatment は作ったときの表現
export type PageItem = { kind: "page"; key: string; name: string; family: SkeletonFamily; treatment: Treatment };
// 部品帳はプロジェクトに 1 件。key は "component-sheet"、name は "部品帳" で固定
export type ComponentSheetItem = { kind: "component-sheet"; key: string; name: string; treatment: Treatment };
// 部品は名前ごとに 1 件。key は componentKeyOf(name)
export type ComponentItem = { kind: "component"; key: string; name: string; treatment: Treatment };
export type SavedItem = PageItem | ComponentSheetItem | ComponentItem;

// 保存の形 (版 3)。開き直したときに作業台の続きから作業できるようにする
export type Project = {
  version: 3;
  id: string;
  brief: Brief;
  pageType: PageType;
  treatment: Treatment;
  rounds: Round[];
  roundIndex: number;
  points: MixPoints;
  fineTune: FineTune;
  items: SavedItem[];
  createdAt: string;
  updatedAt: string;
};

// 面の台帳の 1 件
export type SurfaceEntry = {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  css: string;
  examples: string[];
};
// 動きの見本の 1 件
export type MotionSample = {
  id: string;
  name: string;
  description: string;
  uses: string[]; // 使いどころ (ボタン・見出し・セクションなど)
  technique: string; // 技法 (1 文)
  css: string; // 見本の CSS。色はテーマの変数と color-mix() だけ。prefers-reduced-motion の扱いを必ず含む
  html: string; // 見本の HTML (body の中に入る断片)
  support: "baseline" | "fallback"; // baseline = 主要ブラウザで Baseline / fallback = 一部のブラウザだけ。@supports で代わりの見た目つき
  supportNote: string; // 対応の説明 (1 文)
  continuous: boolean; // ずっと動き続けるか
  scrollLinked: boolean; // スクロールに連動するか
  reducedMotion: string; // reduced-motion のときにどうするか (1 文)
  references: string[]; // 参考にしたページの https の URL (1 件以上)
};
