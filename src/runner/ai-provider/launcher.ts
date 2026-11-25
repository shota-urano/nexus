import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import type { LaunchedProcess, Launcher, ProcessEnd } from "./types";

// 本番の起動の口。子のプロセスを起動するのはここだけである（DD-01 1.3、3章。NFR-016）。
// シェルを通さず、引数の配列で起動する（X-07 3章）。

// 標準エラーは末尾だけを持つ（失敗の理由の元。DD-06 5章）。
const STDERR_KEEP = 4000;

export const spawnLauncher: Launcher = (spec) => {
  // 作業の場所は空のフォルダで、本人のユーザだけが使える（DD-09 2.5）。
  mkdirSync(spec.cwd, { recursive: true, mode: 0o700 });

  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    // 決めた環境変数だけを渡す（DD-09 2.5）。Next.js の型が NODE_ENV を求めるので型だけを合わせる。
    env: { ...spec.env } as NodeJS.ProcessEnv,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP);
  });
  // 子が先に終わると標準入力の書き込みが失敗する（EPIPE）。終わり方は ended で決まるので、
  // ここでは理由を標準エラーの末尾に足して残す（DD-06 1章 握りつぶしの禁止）。
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    stderr = (
      stderr + `\n[nexus] 標準入力に書けない: ${error.code ?? error.name}`
    ).slice(-STDERR_KEEP);
  });

  const ended = new Promise<ProcessEnd>((resolve) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      // 起動できなかった（コマンドが無いなど）。起動した後の kill の失敗はここに来ても close で決まる。
      if (child.pid === undefined)
        resolve({
          launchError: error.code ?? error.name,
          code: null,
          signal: null,
        });
    });
    child.once("close", (code, signal) => {
      resolve({ launchError: null, code, signal });
    });
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  const process: LaunchedProcess = {
    writeInput: (input) => {
      child.stdin.end(input, "utf8");
    },
    lines,
    stderr: () => stderr,
    kill: (signal) => {
      child.kill(signal);
    },
    ended,
  };
  return process;
};
