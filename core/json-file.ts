import { readFileSync } from "node:fs";
import { CliExit, EXIT_INPUT } from "./cli-exit.ts";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** JSON ファイルを読む。BOM を除き、読めない・壊れているときは CliExit(1, {error:"file"}) を投げる */
export function readJsonFile(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: label, path, message: errorMessage(e) });
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliExit(EXIT_INPUT, { error: "file", file: label, path, message: `JSON として読めません: ${errorMessage(e)}` });
  }
}
