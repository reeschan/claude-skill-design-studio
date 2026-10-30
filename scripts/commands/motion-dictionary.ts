// 動きの辞書を JSON で返す。--markdown で DESIGN.md の Motion 節にする。
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { loadMotionDictionary } from "../../core/motion-dictionary.ts";
import { motionDesignMarkdown } from "../../core/motion-design.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Flags = { markdown: boolean; out: string | undefined };

function readFlags(args: string[]): Flags {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        markdown: { type: "boolean", default: false },
        out: { type: "string" },
      },
    });
    return { markdown: parsed.values.markdown, out: parsed.values.out };
  } catch (e) {
    if (e instanceof CliExit) throw e;
    throw usage(errorMessage(e));
  }
}

function writeOut(path: string, markdown: string): void {
  try {
    writeFileSync(path, markdown, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: "out", path, message: errorMessage(e) });
  }
}

function summary() {
  const dict = loadMotionDictionary();
  return {
    triggers: dict.triggers,
    effects: dict.effects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      aliases: effect.aliases,
      category: effect.category,
      trigger: effect.trigger,
      scene: effect.scene,
      prohibition: effect.prohibition,
      reducedMotionKind: effect.reducedMotionKind,
      cssCapability: effect.cssCapability,
      reuseSample: effect.reuseSample,
    })),
  };
}

export function run(args: string[]): Promise<unknown> {
  const flags = readFlags(args);
  if (!flags.markdown && flags.out === undefined) return Promise.resolve(summary());
  const markdown = motionDesignMarkdown();
  if (flags.out !== undefined) writeOut(flags.out, markdown);
  return Promise.resolve({ markdown: flags.out === undefined ? markdown : null, file: flags.out ?? null });
}
