// P08: 1秒ごとに文を1つずつ SSE で流す。AI は呼ばない（試作の決まった文）。
export const dynamic = "force-dynamic";

const PARTS = ["これは", "試作の", "応答です。", "1秒ごとに", "少しずつ", "届くかを", "確かめて", "います。", "まとめて", "届いたら", "区切られて", "います。"];

export async function GET(req: Request) {
  const n = Math.min(Number(new URL(req.url).searchParams.get("n") ?? 12), 60);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (let i = 0; i < n; i++) {
        const t = new Date().toISOString().slice(11, 19);
        const text = PARTS[i % PARTS.length];
        c.enqueue(enc.encode(`id: ${i}\ndata: ${req.url.includes("stamp=1") ? `${t} ${text}` : text}\n\n`));
        await new Promise((r) => setTimeout(r, 1000));
        if (req.signal.aborted) { c.close(); return; }
      }
      c.enqueue(enc.encode("data: [done]\n\n"));
      c.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
