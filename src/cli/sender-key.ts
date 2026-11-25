import {
  type SenderKeys,
  unknownSenderMessage,
} from "../server/auth/sender-key";
import { NexusError } from "../server/shared/errors";

// 管理のコマンド M30 の `sender-key issue|list|revoke`（DD-01 M30。DD-02 FN-024）。
// 鍵は作ったときに1回だけ出す。一覧に鍵と照合値は出さない。
// コマンドの名前の全体（実行する道具の名前）は DD-09 で決める（DD-02 FN-024 手順 4）。ここは引数から先を受ける。

export interface CommandOutput {
  out(line: string): void;
  err(line: string): void;
}

export interface SenderKeyCommandDeps {
  senderKeys: SenderKeys;
  output: CommandOutput;
}

const USAGE =
  "使い方: sender-key issue <配信元> | sender-key list | sender-key revoke <配信元>";

// `sender-key` の後の引数を受け、終了コードを返す。
export function runSenderKeyCommand(
  args: readonly string[],
  deps: SenderKeyCommandDeps,
): number {
  const { senderKeys, output } = deps;
  const [subcommand, ...rest] = args;
  try {
    if (subcommand === "issue" && rest.length === 1) {
      const { key } = senderKeys.issue(rest[0]);
      output.out(key);
      return 0;
    }
    if (subcommand === "list" && rest.length === 0) {
      for (const entry of senderKeys.list()) {
        output.out(`${entry.sender}\t${entry.issuedAt}`);
      }
      return 0;
    }
    if (subcommand === "revoke" && rest.length === 1) {
      senderKeys.revoke(rest[0]);
      return 0;
    }
  } catch (error) {
    // E07（配信元の名前が値に無い）は MSG-044 と終了コード 1（DD-06 2章）。
    if (error instanceof NexusError && error.msg === "MSG-044") {
      output.err(unknownSenderMessage(rest[0]));
      return 1;
    }
    throw error;
  }
  output.err(USAGE);
  return 1;
}
