// デザインガイドの値 (トンマナと部品の使い方) の検証・LLM 向けの JSON Schema・design-guide.md の組み立てと、
// フォルダに置くファイル一式の検証・書き出し。取り決めは docs/pbi/notes/contract.md の 2 節
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";
import { hasPageCsp } from "./page-html.ts";
import { findMotion, findSurface } from "./treatment.ts";
import { COMPONENT_CANDIDATES } from "./types.ts";
import type { MotionLevel, Treatment } from "./types.ts";

// 保存の item の key と名前、プロジェクトの中のフォルダ名
export const DESIGN_GUIDE_KEY = "design-guide";
export const DESIGN_GUIDE_NAME = "デザインガイド";
export const DESIGN_GUIDE_DIR = "design-guide";
// 古い style-guide のときに、画面と標準出力で知らせる文言
export const STYLE_GUIDE_UPDATE_NOTICE = "style-guide を更新するとデザインガイドも作れます";

// フォルダに置くファイル。この並びを正とする
export const DESIGN_GUIDE_FILE_NAMES = ["design-guide.md", "style-guide.md", "component-sheet.html", "theme.css", "theme.json"] as const;
export type DesignGuideFileName = (typeof DESIGN_GUIDE_FILE_NAMES)[number];
export type DesignGuideFile = { name: DesignGuideFileName; content: string };

// 必ず置くファイル。design-guide.md と style-guide.md は両方あるか両方ないか
const REQUIRED_FILE_NAMES: readonly DesignGuideFileName[] = ["component-sheet.html", "theme.css", "theme.json"];

// LLM が返す・会話の中で Claude が書く値 (2.2)
export type ToneExample = { situation: string; text: string };
export type ToneWords = { voice: string; style: string; useWords: string[]; avoidWords: string[]; examples: ToneExample[] };
export type ToneVisual = { keywords: string[]; treatmentUsage: string[]; avoid: string[] };
export type ComponentUsage = { id: string; purpose: string; states: string; whereToUse: string; dont: string };
export type DesignGuideValues = { tone: { words: ToneWords; visual: ToneVisual }; components: ComponentUsage[] };
// design-guide.md の組み立ての入力 (2.3)
export type DesignGuideMdInput = { directionName: string; treatment: Treatment; values: DesignGuideValues };

const NO_SAMPLE = "指定なし (部品帳の中で AI が選んだもの)";
const MOTION_NAMES: Record<MotionLevel, string> = { none: "なし", subtle: "控えめ", animated: "Animated" };
// 文字列に含められない制御文字 (改行・タブを含む)
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const inputError = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "input", message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isFileName = (value: string): value is DesignGuideFileName => (DESIGN_GUIDE_FILE_NAMES as readonly string[]).includes(value);

// 決まりを満たす文字列。trim してから文字数 (コードポイント) を数え、制御文字を含まない
function boundedText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw inputError(`${label} は ${min}〜${max} 文字の文字列で指定してください`);
  const text = value.trim();
  const length = [...text].length;
  if (CONTROL_RE.test(value) || length < min || length > max) {
    throw inputError(`${label} は ${min}〜${max} 文字の文字列で指定してください`);
  }
  return text;
}

// 件数の範囲と、各件の文字数の範囲を持つ文字列の配列
function textList(value: unknown, label: string, minItems: number, maxItems: number, min: number, max: number): string[] {
  if (!Array.isArray(value)) throw inputError(`${label} は文字列の配列で指定してください`);
  if (value.length < minItems || value.length > maxItems) {
    throw inputError(`${label} は ${minItems}〜${maxItems} 件で指定してください`);
  }
  return value.map((item, index) => boundedText(item, `${label}[${index}]`, min, max));
}

function examplesOf(value: unknown): ToneExample[] {
  if (!Array.isArray(value)) throw inputError("tone.words.examples は配列で指定してください");
  if (value.length < 1 || value.length > 8) throw inputError("tone.words.examples は 1〜8 件で指定してください");
  return value.map((item, index) => {
    const label = `tone.words.examples[${index}]`;
    if (!isRecord(item)) throw inputError(`${label} はオブジェクトで指定してください`);
    return {
      situation: boundedText(item.situation, `${label}.situation`, 1, 40),
      text: boundedText(item.text, `${label}.text`, 1, 200),
    };
  });
}

function wordsOf(value: unknown): ToneWords {
  if (!isRecord(value)) throw inputError("tone.words はオブジェクトで指定してください");
  return {
    voice: boundedText(value.voice, "tone.words.voice", 1, 80),
    style: boundedText(value.style, "tone.words.style", 1, 200),
    useWords: textList(value.useWords, "tone.words.useWords", 1, 12, 1, 40),
    avoidWords: textList(value.avoidWords, "tone.words.avoidWords", 1, 12, 1, 40),
    examples: examplesOf(value.examples),
  };
}

function visualOf(value: unknown): ToneVisual {
  if (!isRecord(value)) throw inputError("tone.visual はオブジェクトで指定してください");
  return {
    keywords: textList(value.keywords, "tone.visual.keywords", 3, 5, 1, 20),
    treatmentUsage: textList(value.treatmentUsage, "tone.visual.treatmentUsage", 1, 8, 1, 200),
    avoid: textList(value.avoid, "tone.visual.avoid", 1, 8, 1, 200),
  };
}

function componentUsageOf(value: unknown, index: number, id: string): ComponentUsage {
  const label = `components[${index}]`;
  if (!isRecord(value)) throw inputError(`${label} はオブジェクトで指定してください`);
  if (value.id !== id) throw inputError(`${label}.id は ${id} を指定してください`);
  return {
    id,
    purpose: boundedText(value.purpose, `${label}.purpose`, 1, 300),
    states: boundedText(value.states, `${label}.states`, 1, 300),
    whereToUse: boundedText(value.whereToUse, `${label}.whereToUse`, 1, 300),
    dont: boundedText(value.dont, `${label}.dont`, 1, 300),
  };
}

function componentsOf(value: unknown): ComponentUsage[] {
  if (!Array.isArray(value)) throw inputError("components は配列で指定してください");
  if (value.length !== COMPONENT_CANDIDATES.length) {
    throw inputError(`components は ${COMPONENT_CANDIDATES.length} 件で指定してください`);
  }
  return COMPONENT_CANDIDATES.map((candidate, index) => componentUsageOf(value[index], index, candidate.id));
}

/** 外部入力の値を検証し、文字列を trim した値を返す。外れたら CliExit(1, {error:"input"})。余分なキーは返り値に入れない */
export function validateDesignGuideValues(x: unknown): DesignGuideValues {
  if (!isRecord(x)) throw inputError("デザインガイドの値はオブジェクトで指定してください");
  const tone = x.tone;
  if (!isRecord(tone)) throw inputError("tone はオブジェクトで指定してください");
  return {
    tone: { words: wordsOf(tone.words), visual: visualOf(tone.visual) },
    components: componentsOf(x.components),
  };
}

/** LLM の構造化出力の JSON Schema (2.2 の決まりと同じ制約。additionalProperties: false、required は全部) */
export const DESIGN_GUIDE_VALUES_SCHEMA: object = {
  type: "object",
  additionalProperties: false,
  required: ["tone", "components"],
  properties: {
    tone: {
      type: "object",
      additionalProperties: false,
      required: ["words", "visual"],
      properties: {
        words: {
          type: "object",
          additionalProperties: false,
          required: ["voice", "style", "useWords", "avoidWords", "examples"],
          properties: {
            voice: { type: "string", minLength: 1, maxLength: 80 },
            style: { type: "string", minLength: 1, maxLength: 200 },
            useWords: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            avoidWords: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            examples: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["situation", "text"],
                properties: {
                  situation: { type: "string", minLength: 1, maxLength: 40 },
                  text: { type: "string", minLength: 1, maxLength: 200 },
                },
              },
            },
          },
        },
        visual: {
          type: "object",
          additionalProperties: false,
          required: ["keywords", "treatmentUsage", "avoid"],
          properties: {
            keywords: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string", minLength: 1, maxLength: 20 },
            },
            treatmentUsage: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
            avoid: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
        },
      },
    },
    components: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "purpose", "states", "whereToUse", "dont"],
        properties: {
          id: { type: "string", enum: COMPONENT_CANDIDATES.map((candidate) => candidate.id) },
          purpose: { type: "string", minLength: 1, maxLength: 300 },
          states: { type: "string", minLength: 1, maxLength: 300 },
          whereToUse: { type: "string", minLength: 1, maxLength: 300 },
          dont: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
    },
  },
};

// 表のセルの値。Markdown の区切りと混ざらないよう、| を \| にする
const cell = (value: string): string => value.replaceAll("|", "\\|");

function surfaceNameOf(treatment: Treatment): string {
  return findSurface(treatment.surface)?.name ?? treatment.surface;
}

function sampleNamesOf(treatment: Treatment): string {
  if (treatment.motion !== "animated") return MOTION_NAMES.none;
  if (treatment.motionSamples.length === 0) return NO_SAMPLE;
  return treatment.motionSamples.map((id) => findMotion(id)?.name ?? id).join("、");
}

function wordsLines(words: ToneWords): string[] {
  return [
    "### 言葉",
    "",
    `- 口調: ${words.voice}`,
    `- 文体: ${words.style}`,
    `- 使う言葉: ${words.useWords.join("、")}`,
    `- 避ける言葉: ${words.avoidWords.join("、")}`,
    "",
    "#### 文言の例",
    "",
    "| 場面 | 文言 |",
    "| --- | --- |",
    ...words.examples.map((example) => `| ${cell(example.situation)} | ${cell(example.text)} |`),
  ];
}

function componentLines(component: ComponentUsage, index: number): string[] {
  const name = COMPONENT_CANDIDATES[index]?.name ?? component.id;
  return [
    `### ${name}`,
    "",
    `- 用途: ${component.purpose}`,
    `- 状態: ${component.states}`,
    `- 使いどころ: ${component.whereToUse}`,
    `- してはいけないこと: ${component.dont}`,
  ];
}

/** design-guide.md の中身を決まった形で組み立てる。同じ入力から同じ文字列。末尾は改行 1 つ */
export function designGuideMarkdown(input: DesignGuideMdInput): string {
  const { values } = input;
  const lines: string[] = [
    `# デザインガイド: ${input.directionName}`,
    "",
    "## トンマナ",
    "",
    ...wordsLines(values.tone.words),
    "",
    "### 見た目",
    "",
    `- 性格を表すキーワード: ${values.tone.visual.keywords.join("、")}`,
    "",
    "#### 表現の使いどころ",
    "",
    ...values.tone.visual.treatmentUsage.map((item) => `- ${item}`),
    "",
    "#### 避けること",
    "",
    ...values.tone.visual.avoid.map((item) => `- ${item}`),
    "",
    "## 表現",
    "",
    `- 面: ${surfaceNameOf(input.treatment)}`,
    `- 動き: ${MOTION_NAMES[input.treatment.motion]}`,
    `- 使った動きの見本: ${sampleNamesOf(input.treatment)}`,
    "",
    "## 部品",
    "",
  ];
  for (const [index, component] of values.components.entries()) {
    if (index > 0) lines.push("");
    lines.push(...componentLines(component, index));
  }
  lines.push(
    "",
    "## 参照",
    "",
    "- スタイルガイド (色トークン・フォント・コントラスト): [style-guide.md](style-guide.md)",
    "- 部品帳: [component-sheet.html](component-sheet.html)",
    "- テーマ: [theme.css](theme.css)・[theme.json](theme.json)",
  );
  return `${lines.join("\n")}\n`;
}

function fileOf(value: unknown, index: number): DesignGuideFile {
  const label = `files[${index}]`;
  if (!isRecord(value)) throw inputError(`${label} はオブジェクトで指定してください`);
  const name = value.name;
  if (typeof name !== "string" || !isFileName(name)) {
    throw inputError(`${label}.name は ${DESIGN_GUIDE_FILE_NAMES.join(" / ")} のいずれかで指定してください`);
  }
  if (typeof value.content !== "string") throw inputError(`${label}.content は文字列で指定してください`);
  return { name, content: value.content };
}

/** 外部入力のファイルの並びを検証し、DESIGN_GUIDE_FILE_NAMES の順に並べ直して返す。外れたら CliExit(1, {error:"input"}) */
export function validateDesignGuideFiles(x: unknown): DesignGuideFile[] {
  if (!Array.isArray(x)) throw inputError("files は配列で指定してください");
  const byName = new Map<DesignGuideFileName, DesignGuideFile>();
  for (const [index, value] of x.entries()) {
    const file = fileOf(value, index);
    if (byName.has(file.name)) throw inputError(`files に ${file.name} が 2 回あります`);
    byName.set(file.name, file);
  }
  for (const name of REQUIRED_FILE_NAMES) {
    if (!byName.has(name)) throw inputError(`files に ${name} がありません`);
  }
  if (byName.has("design-guide.md") !== byName.has("style-guide.md")) {
    throw inputError("design-guide.md と style-guide.md は両方あるか両方ないかにしてください");
  }
  const sheet = byName.get("component-sheet.html");
  if (sheet === undefined || !hasPageCsp(sheet.content)) {
    throw inputError("files の component-sheet.html は CSP の meta (PAGE_CSP) を持つ HTML にしてください");
  }
  return DESIGN_GUIDE_FILE_NAMES.flatMap((name) => {
    const file = byName.get(name);
    return file === undefined ? [] : [file];
  });
}

/**
 * dir に files を書く。DESIGN_GUIDE_FILE_NAMES のうち files に無いものが dir にあれば消す (古いガイドの残りを置かない)。
 * dir のほかのファイル・フォルダには触らない (dir ごと消さない)。dir は無ければ作る。戻り値は dir の絶対パス
 */
export function writeDesignGuideFolder(dir: string, files: DesignGuideFile[]): string {
  const absolute = resolve(dir);
  mkdirSync(absolute, { recursive: true });
  const present = new Set(files.map((file) => file.name));
  for (const name of DESIGN_GUIDE_FILE_NAMES) {
    const path = join(absolute, name);
    if (!present.has(name) && existsSync(path)) rmSync(path, { force: true });
  }
  for (const file of files) writeFileSync(join(absolute, file.name), file.content, "utf8");
  return absolute;
}
