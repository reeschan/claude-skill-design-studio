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

export const PAGE_TYPES = ["lp", "dashboard", "blog"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export const LAYOUTS = {
  lp: ["centered", "split", "fullbleed"],
  dashboard: ["sidebar", "topnav", "cards"],
  blog: ["classic", "magazine", "minimal"],
} as const;
export type Layouts = {
  lp: (typeof LAYOUTS.lp)[number];
  dashboard: (typeof LAYOUTS.dashboard)[number];
  blog: (typeof LAYOUTS.blog)[number];
};
export const MIX_AXES = ["color", "font", "shape", "layout"] as const;
export type MixAxis = (typeof MIX_AXES)[number];
export type MixPicks = Record<MixAxis, number>; // 方向性の配列の添字

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

export type Project = {
  id: string;
  prompt: string;
  pageType: PageType;
  direction: Direction;
  pages: PageType[];
  createdAt: string;
  updatedAt: string;
};
