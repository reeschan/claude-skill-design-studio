// CLI の終わり方の約束。サブコマンドは失敗を CliExit で伝え、入口 (scripts/studio.ts) が
// 標準エラーの JSON と終了コードに変える
export const EXIT_OK = 0;
export const EXIT_INPUT = 1;
export const EXIT_ACTION = 2;
export const EXIT_EXTERNAL = 3;

/** 終了コード付きで CLI を止めるための例外。payload はそのまま標準エラーに出す */
export class CliExit extends Error {
  code: number;
  payload: Record<string, unknown>;
  constructor(code: number, payload: Record<string, unknown>) {
    const message = payload.message;
    super(typeof message === "string" ? message : String(payload.error));
    this.name = "CliExit";
    this.code = code;
    this.payload = payload;
  }
}

/** 入力の誤り (終了コード 1) を作る */
export const usage = (message: string): CliExit => new CliExit(EXIT_INPUT, { error: "usage", message });
