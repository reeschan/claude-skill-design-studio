// ゆるい言い方を、セクション (と任意の対象) の動き entry にする。
// 標準出力は JSON。検証エラーは CliExit(1) で、メッセージは日本語。
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CliExit, EXIT_INPUT, usage } from "../../core/cli-exit.ts";
import { motionDesignMarkdown } from "../../core/motion-design.ts";
import { normalizeMotion } from "../../core/motion-normalize.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Flags = {
  section: string;
  phrase: string;
  target: string | undefined;
  reason: string | undefined;
  markdown: boolean;
  out: string | undefined;
};

function readFlags(args: string[]): Flags {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        section: { type: "string" },
        target: { type: "string" },
        reason: { type: "string" },
        phrase: { type: "string" },
        markdown: { type: "boolean", default: false },
        out: { type: "string" },
      },
    });
    const phrase = parsed.values.phrase ?? parsed.positionals.join(" ");
    const section = parsed.values.section;
    if (section === undefined || phrase.trim() === "") {
      throw usage('normalize-motion は --section <section> と "<言い方>" を指定してください');
    }
    return {
      section,
      phrase,
      target: parsed.values.target,
      reason: parsed.values.reason,
      markdown: parsed.values.markdown,
      out: parsed.values.out,
    };
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

export async function run(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  const flags = readFlags(args);
  const result = await normalizeMotion({ section: flags.section, phrase: flags.phrase, target: flags.target, reason: flags.reason }, env);
  if (!result.ok) throw new CliExit(EXIT_INPUT, { error: "input", message: result.errors.join(" "), errors: result.errors });
  const markdown = flags.markdown || flags.out !== undefined ? motionDesignMarkdown(result.entries) : undefined;
  if (flags.out !== undefined && markdown !== undefined) writeOut(flags.out, markdown);
  return { ...result, markdown: flags.out === undefined ? markdown : undefined, file: flags.out ?? null };
}
