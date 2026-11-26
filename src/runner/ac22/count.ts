import { statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

// AC22 の証拠の数える処理（13-release の実装単位4。NFR-016、NFR-019、DD-09 2.5「AC22 の証拠の残し方」手順 3）。
// eventLogDir の中の全ての `<実行ID>.jsonl` を読み、assistant の出来事の tool_use と、user の出来事の
// tool_result を tool_use_id で組にして数える。数だけを返し、中身は返さない（手順 4）。

export type Ac22Purpose = "answer" | "relate" | "summarize";

export interface Ac22CountInput {
  eventLogDir: string;
  // 読み取りを許す場所（作業の場所と --add-dir のフォルダ）。絶対の道。
  allowedDirs: string[];
  // 読ませないファイルの型。絶対の道のグロブ（`**`、`*`、`?`）。
  denyReadPatterns: string[];
  // ページの読み取りを拒む宛先。`*.ts.net` のような先頭の `*.` を許す。
  denyFetchDomains: string[];
  // 実行ID（ファイル名から `.jsonl` を除いたもの）から用途への対応。呼ぶ側が ai_runs から作る。
  purposeByRunId: Record<string, Ac22Purpose>;
}

export interface Ac22Counts {
  writeEditNotebookBashCalls: number;
  forbiddenReadSuccesses: number;
  relateSummarizeToolCalls: number;
  forbiddenFetchSuccesses: number;
}

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);

export async function countAc22Evidence(
  input: Ac22CountInput,
): Promise<Ac22Counts> {
  const counts: Ac22Counts = {
    writeEditNotebookBashCalls: 0,
    forbiddenReadSuccesses: 0,
    relateSummarizeToolCalls: 0,
    forbiddenFetchSuccesses: 0,
  };
  const allowedDirs = input.allowedDirs.map((dir) => resolve(dir));
  const denyRead = input.denyReadPatterns.map(globToRegExp);
  const workdir = allowedDirs[0];

  const names = (await readdir(input.eventLogDir))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  for (const name of names) {
    const runId = basename(name, ".jsonl");
    const purpose = input.purposeByRunId[runId];
    const { uses, errors, results } = parseRun(
      await readFile(join(input.eventLogDir, name), "utf8"),
    );
    for (const use of uses) {
      if (purpose === "relate" || purpose === "summarize") {
        counts.relateSummarizeToolCalls += 1;
      }
      if (WRITE_TOOLS.has(use.name)) {
        counts.writeEditNotebookBashCalls += 1;
      }
      // 成功は tool_result の is_error が偽であるときだけ。結果の無い呼び出しは成功として数えない。
      // errors には「失敗か、成功と決められない」を入れる。false のときだけ is_error が真偽値の false。
      const succeeded = errors.get(use.id) === false;
      if (!succeeded) continue;
      if (READ_TOOLS.has(use.name)) {
        const paths = readTargets(use, workdir);
        if (use.name === "Glob" || use.name === "Grep") {
          paths.push(
            ...resultPaths(use, results.get(use.id), searchBase(use, workdir)),
          );
        }
        if (
          paths.some(
            (path) =>
              !allowedDirs.some((dir) => isInside(path, dir)) ||
              denyRead.some((re) => re.test(path)),
          )
        ) {
          counts.forbiddenReadSuccesses += 1;
        }
      } else if (use.name === "WebFetch") {
        const host = hostOf(use.input.url);
        if (
          host !== null &&
          input.denyFetchDomains.some((domain) => domainMatches(host, domain))
        ) {
          counts.forbiddenFetchSuccesses += 1;
        }
      }
    }
  }
  return counts;
}

function parseRun(text: string): {
  uses: ToolUse[];
  errors: Map<string, boolean>;
  results: Map<string, string>;
} {
  const uses = new Map<string, ToolUse>();
  const errors = new Map<string, boolean>();
  const results = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    // 部分の出来事（stream_event）は数えず、assistant の出来事だけを tool_use の正本にする。
    if (event.type !== "assistant" && event.type !== "user") continue;
    const message = event.message;
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      if (
        event.type === "assistant" &&
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        uses.set(block.id, {
          id: block.id,
          name: block.name,
          input: isRecord(block.input) ? block.input : {},
        });
      } else if (
        event.type === "user" &&
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        // 成功は is_error が真偽値の false のときだけ（DD-09 2.5 手順 3「is_error が偽だった」）。
        // is_error が無いときや真偽値でないときは、成功と決められないので成功として数えない。
        errors.set(block.tool_use_id, block.is_error !== false);
        results.set(block.tool_use_id, resultText(block.content));
      }
    }
  }
  return { uses: [...uses.values()], errors, results };
}

// tool_result の content は文字列か、`{ type: "text", text }` の並び。
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("\n");
}

// Glob と Grep の検索先。path が無ければ作業の場所。
function searchBase(use: ToolUse, workdir: string | undefined): string {
  const path = use.input.path;
  if (typeof path === "string" && path !== "") {
    return resolve(workdir ?? "/", expandHome(path));
  }
  return workdir ?? "/";
}

// Glob と Grep の結果に並んだファイルの道を1行ずつ取り出す（本人の答え、案A）。相対の道は検索先を起点にする。
// 件数の見出しや「見つからない」の行は道でないので除く。Grep は output_mode に合わせて道と本文を分ける。
//   - files_with_matches（既定）と Glob: 1行が1つの道。
//   - count: `道:件数`。
//   - content: 一致の行は `道:行番号:本文`（-n が偽なら `道:本文`）、前後の行（-A、-B、-C、context）は
//     `道-行番号-本文`（-n が偽なら `道-本文`）。
// 1つのファイルだけを検索したとき、content と count の行には道が付かず本文（または件数）だけが並ぶので、
// 道として読まない（そのファイル自身は readTargets で判定済み）。検索先がファイルかどうかを確かめられない
// ときに備え、content の行から取った道は検索先の下にあるものだけを残す（フォルダを検索したときの道は、
// 必ず検索先の下にある）。
function resultPaths(
  use: ToolUse,
  text: string | undefined,
  base: string,
): string[] {
  if (text === undefined) return [];
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line === "--") continue;
    if (
      /^(Found \d+ |No (files|matches) found|\(Results are truncated)/.test(
        line,
      )
    ) {
      continue;
    }
    lines.push(line);
  }
  const mode = use.name === "Grep" ? use.input.output_mode : undefined;
  if ((mode === "content" || mode === "count") && isFile(base)) return [];
  let paths: string[];
  if (mode === "content") {
    paths = grepContentPaths(lines, use.input);
  } else if (mode === "count") {
    paths = lines.map((line) => line.replace(/:\d+$/, ""));
  } else {
    paths = lines;
  }
  const resolved = paths.map((path) => resolve(base, expandHome(path)));
  return mode === "content"
    ? resolved.filter((path) => isInside(path, base) && path !== base)
    : resolved;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Grep の content の出力から道を取り出す。一致の行の道は、-n が偽でなければ最初の `:行番号:` の前
// （見つからなければ最初の `:` の前）、-n が偽なら最初の `:` の前とする。前後の行を出す設定のときは、
// 前後の行の `-` と本文の中の `:` を区別できないので、一致の行から取った道のうち、その行の頭に
// `:` か `-` を続けて当たる最も長いものをその行の道とする（前後の行のファイルには必ず一致の行がある）。
// 最も長いものを選ぶので、一致の行はその行から取った完全な道が優先され、短い道の前後の行と取り違えない
// （例: `/a/notes:hit` と `/a/notes-secret.md:hit` の2行目は `/a/notes-secret.md` とする）。
function grepContentPaths(
  lines: string[],
  input: Record<string, unknown>,
): string[] {
  const lineNumbers = input["-n"] !== false;
  const matchPath = (line: string): string | undefined => {
    const numbered = lineNumbers ? /:\d+:/.exec(line) : null;
    const idx = numbered ? numbered.index : line.indexOf(":");
    return idx > 0 ? line.slice(0, idx) : undefined;
  };
  const hasContext = ["-A", "-B", "-C", "context"].some(
    (key) => typeof input[key] === "number" && (input[key] as number) > 0,
  );
  const candidates = new Set<string>();
  for (const line of lines) {
    const path = matchPath(line);
    if (path !== undefined) candidates.add(path);
  }
  if (!hasContext) return [...candidates];
  const sepRe = lineNumbers ? /^(?::\d+:|-\d+-)/ : /^[:-]/;
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const paths = new Set<string>();
  for (const line of lines) {
    const path = sorted.find(
      (c) => line.startsWith(c) && sepRe.test(line.slice(c.length)),
    );
    if (path !== undefined) paths.add(path);
  }
  return [...paths];
}

// Read は file_path、Glob と Grep は path（無ければ作業の場所）を指す。Glob の pattern と Grep の glob も
// 読む先の型なので、検索先を起点にした道（絶対の道ならそのまま）にして判定に含める。Grep の glob に `/` が
// 無いときは、どの深さのファイル名にも当たる（ripgrep の決まり）ので、検索先の下の `**/` を付けた道も見る。
function readTargets(use: ToolUse, workdir: string | undefined): string[] {
  const targets: string[] = [];
  const toPath = (base: string, value: string) =>
    resolve(base, expandHome(value));
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value !== "" ? value : undefined;
  if (use.name === "Read") {
    const filePath = str(use.input.file_path);
    if (filePath !== undefined) targets.push(toPath(workdir ?? "/", filePath));
    return targets;
  }
  const path = str(use.input.path);
  const base = path !== undefined ? toPath(workdir ?? "/", path) : workdir;
  if (base !== undefined) targets.push(base);
  const root = base ?? "/";
  if (use.name === "Glob") {
    const pattern = str(use.input.pattern);
    if (pattern !== undefined) targets.push(toPath(root, pattern));
  } else if (use.name === "Grep") {
    const glob = str(use.input.glob);
    if (glob !== undefined) {
      targets.push(toPath(root, glob));
      if (!glob.includes("/")) targets.push(join(root, "**", glob));
    }
  }
  return targets;
}

function expandHome(value: string): string {
  const home = process.env.HOME;
  if (home && (value === "~" || value.startsWith("~/"))) {
    return join(home, value.slice(1));
  }
  return value;
}

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

// `**/` は0個以上のフォルダ（`.` で始まるものも含む）、末尾の `/**` はそのフォルダ自身と中の全て、
// `*` は `/` を含まない0文字以上、`?` は `/` でない1文字に当てる。
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (pattern.startsWith("/**", i) && i + 3 === pattern.length) {
      out += "(?:/.*)?";
      break;
    }
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 2;
    } else if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 1;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase();
  if (d.startsWith("*.")) return host.endsWith(d.slice(1));
  return host === d;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
