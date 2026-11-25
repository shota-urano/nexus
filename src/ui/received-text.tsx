import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// 届いた文の表示（BD-09 6章、ADR-018、DD-01 M07）。
// 案内、教材の本文、問題、AI の応答の Markdown を、決めた書式（見出し、段落、箇条書き、
// 強調、表、リンク）だけで見せる。
// - 文の中の HTML は要素にしない（skipHtml）。生の HTML を描く部品（rehype-raw など）を
//   足さない。`dangerouslySetInnerHTML` を使わない（X-07 3章、RD-12 NFR-018）。
// - 決めた書式の外の要素（画像、コード、引用など）は作らず、中の文字だけを残す。
// - リンクは http と https だけを `a` にし、端末のブラウザで開く。ほかは文字だけにする。

const ALLOWED_ELEMENTS = [
  // 見出し
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // 段落（段落の中の改行を含む）
  "p",
  "br",
  // 箇条書き
  "ul",
  "ol",
  "li",
  // 強調
  "strong",
  "em",
  // 表（remark-gfm）
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  // リンク
  "a",
];

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeLink(href: string | undefined): href is string {
  if (!href) return false;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    // 絶対の URL として読めないもの（相対の道など）はリンクにしない。
    return false;
  }
}

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  if (!isSafeLink(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  );
}

const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mt-4 text-xl font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 text-lg font-bold">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mt-3 text-base font-bold">{children}</h3>
  ),
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
};

export function ReceivedText({ markdown }: { markdown: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
