// ui-skills.com の索引から下書きを作り (--lookup)、段階・役割を確かめてから追加台帳に書く
import { parseArgs } from "node:util";
import { validateCatalogEntry } from "../../core/catalog.ts";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { addLocalEntry, draftFromRegistry } from "../../core/registry.ts";
import { STAGES } from "../../core/types.ts";
import type { Draft } from "../../core/registry.ts";
import type { Stage } from "../../core/types.ts";

const DEFAULT_LICENSE = "不明 (取得元で確認)"; // ui-skills.com はライセンスを返さないため利用者が確かめる
const ADDED_NOTE = "ui-skills.com から追加";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type RawArgs = {
  key: string | undefined;
  extra: string[];
  lookup: boolean;
  stage: string | undefined;
  role: string | undefined;
  roleLabel: string | undefined;
  summary: string | undefined;
  license: string | undefined;
  target: string | undefined;
};

type WriteArgs = {
  kind: "write";
  key: string;
  stage: Stage;
  role: string;
  roleLabel: string;
  summary: string | undefined;
  license: string | undefined;
  target: "any" | "react" | undefined;
};

type Parsed = { kind: "lookup"; key: string } | WriteArgs;

// --stage の値を STAGES のいずれかにする
function parseStage(value: string): Stage {
  const stage = STAGES.find((candidate) => candidate === value);
  if (stage === undefined) throw new CliExit(EXIT_INPUT, { error: "input", message: `不明な段階です: ${value}`, stages: STAGES });
  return stage;
}

function parseTarget(value: string): "any" | "react" {
  if (value === "any" || value === "react") return value;
  throw new CliExit(EXIT_INPUT, { error: "input", message: `--target は any か react で指定してください: ${value}` });
}

// strict な parseArgs で読む。知らない引数・値の欠けは usage (1)
function readArgs(args: string[]): RawArgs {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        lookup: { type: "boolean" },
        stage: { type: "string" },
        role: { type: "string" },
        "role-label": { type: "string" },
        summary: { type: "string" },
        license: { type: "string" },
        target: { type: "string" },
      },
    });
    const [key, ...extra] = parsed.positionals;
    return {
      key,
      extra,
      lookup: parsed.values.lookup ?? false,
      stage: parsed.values.stage,
      role: parsed.values.role,
      roleLabel: parsed.values["role-label"],
      summary: parsed.values.summary,
      license: parsed.values.license,
      target: parsed.values.target,
    };
  } catch (e) {
    throw usage(errorMessage(e));
  }
}

// --lookup は下書きだけを見る使い方。書き込みのフラグとは一緒に使えない
function lookupArgs(key: string, raw: RawArgs): Parsed {
  const hasWriteFlags =
    raw.stage !== undefined ||
    raw.role !== undefined ||
    raw.roleLabel !== undefined ||
    raw.summary !== undefined ||
    raw.license !== undefined ||
    raw.target !== undefined;
  if (hasWriteFlags) throw usage("--lookup とほかの引数は一緒に使えません");
  return { kind: "lookup", key };
}

// 書き込みには --stage・--role・--role-label がそろっている必要がある
function writeArgs(key: string, raw: RawArgs): Parsed {
  if (raw.stage === undefined) throw usage(`--stage を指定してください (${STAGES.join(" / ")})`);
  if (raw.role === undefined) throw usage("--role を指定してください");
  if (raw.roleLabel === undefined) throw usage("--role-label を指定してください");
  return {
    kind: "write",
    key,
    stage: parseStage(raw.stage),
    role: raw.role,
    roleLabel: raw.roleLabel,
    summary: raw.summary,
    license: raw.license,
    target: raw.target === undefined ? undefined : parseTarget(raw.target),
  };
}

function parseAddArgs(args: string[]): Parsed {
  const raw = readArgs(args);
  if (raw.extra.length > 0) throw usage(`位置引数は 1 つだけです: ${raw.extra.join(" ")}`);
  if (raw.key === undefined) throw usage("add <owner/skill> --lookup か add <owner/skill> --stage ... の形で指定してください");
  if (raw.lookup) return lookupArgs(raw.key, raw);
  if (raw.stage === undefined) throw usage("--lookup か --stage を指定してください");
  return writeArgs(raw.key, raw);
}

// 下書きに、利用者が確かめた段階・役割・表示名などを重ねて台帳の 1 件にする
function toEntry(draft: Draft, args: WriteArgs): Record<string, unknown> {
  return {
    id: draft.id,
    name: draft.name,
    stage: args.stage,
    role: args.role,
    roleLabel: args.roleLabel,
    isDefault: false,
    source: draft.source,
    prerequisites: [],
    target: args.target ?? "any",
    license: args.license ?? DEFAULT_LICENSE,
    summary: args.summary ?? draft.summary,
    exampleRequest: "",
    exampleOutput: "",
    notes: [ADDED_NOTE],
    invokeFlags: [],
  };
}

export async function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const parsed = parseAddArgs(args);
  const draft = await draftFromRegistry(parsed.key, env);
  if (parsed.kind === "lookup") return { draft };
  // 書き込む前に、台帳として通る形か必ず確かめる
  const entry = validateCatalogEntry(toEntry(draft, parsed), "追加台帳");
  addLocalEntry(env, entry);
  return { entry };
}
