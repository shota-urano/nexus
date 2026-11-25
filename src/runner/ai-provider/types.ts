// AI の呼び出し（DD-01 M26）の型。M25 はこの型だけで AI を呼ぶ。

// 目的（DD-01 M25、DD-09 2.5）。
export type AiPurpose = "answer" | "relate" | "summarize";

// 呼ぶときに渡すもの（DD-01 M26「目的、渡す内容、止める合図」）。
export interface AiRequest {
  purpose: AiPurpose;
  // 標準入力に書く渡す内容（DD-02 3章 P07 で組み立てたもの）。
  input: string;
  // 止める合図。合図が来たら SIGTERM、猶予の後に SIGKILL で止める（DD-06 4章）。
  signal?: AbortSignal;
  // 実行ID（`ai_run.id`）。試験の出来事の記録のファイルの名前に使う（DD-09 2.5 AC22 の 1）。
  runId?: number;
}

// 標準出力の1行から読んだ出来事（DD-04 4.2）。上に無い出来事は読み捨てる。
export type AiEvent =
  // 応答の文の続き（`content_block_delta` の `text_delta`）。
  | { type: "text"; text: string }
  // ツールを使った出来事（`content_block_start` の `tool_use`）。
  | { type: "tool_use"; name: string }
  // `assistant` の出来事の `error`（`authentication_failed`、`rate_limit` など）。
  | { type: "assistant_error"; error: string }
  // `system` の `api_retry`（ログに出す）。
  | { type: "api_retry" }
  // 終わりの出来事。`ok` は `subtype` が `success` で `is_error` が偽のとき真。
  | {
      type: "result";
      ok: boolean;
      subtype: string;
      result: string | null;
      errors: string[];
    }
  // JSON として読めない行（DD-06 E10）。行の中身は持たない（会話の中身を含むため）。
  | { type: "bad_line" };

// 終わりの状態。
export type AiExit =
  // CLI が自分で終わった。終了コード（シグナルで終わったときは null）と標準エラーの末尾（鍵の形を伏せたもの）。
  | {
      kind: "exited";
      exitCode: number | null;
      signal: string | null;
      stderr: string;
    }
  // 止める合図で止めた。`killed` は SIGTERM で終わらず SIGKILL を送ったか（DD-06 4章）。
  // 終了コードは見ない（DD-04 4.2 終了の状態）。
  | { kind: "stopped"; killed: boolean; signal: string | null }
  // CLI を起動できなかった（DD-06 E12）。
  | { kind: "launch_failed"; reason: string };

// 1回の呼び出し。`events` を読み終えてから `exit` を待つ。
export interface AiCall {
  events: AsyncIterable<AiEvent>;
  exit: Promise<AiExit>;
}

export interface AiProvider {
  call(request: AiRequest): AiCall;
}

// 子のプロセスの起動の口（DD-10 3章「偽の起動の口」）。本番は `node:child_process`、試験は偽の AI。
export interface LaunchSpec {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd: string;
}

export type ProcessSignal = "SIGTERM" | "SIGKILL";

export interface ProcessEnd {
  // 起動できなかったときの理由。起動できたときは null。
  launchError: string | null;
  code: number | null;
  signal: string | null;
}

export interface LaunchedProcess {
  // 標準入力に全てを書いて閉じる。
  writeInput(input: string): void;
  // 標準出力の1行ずつ。
  lines: AsyncIterable<string>;
  // これまでの標準エラー（中身はそのまま。伏せるのは M26 の側）。
  stderr(): string;
  kill(signal: ProcessSignal): void;
  ended: Promise<ProcessEnd>;
}

export type Launcher = (spec: LaunchSpec) => LaunchedProcess;
