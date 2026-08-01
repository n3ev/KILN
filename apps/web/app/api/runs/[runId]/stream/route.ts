import { getRun, listRunEvents } from "../../../../../lib/queries";

export const dynamic = "force-dynamic";

const sequence = (value: string | null): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= -1 ? parsed : -1;
};

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
  const url = new URL(request.url);
  const queryAfter = sequence(url.searchParams.get("after"));
  const headerAfter = sequence(request.headers.get("last-event-id"));
  const resumeAfter = Math.max(queryAfter, headerAfter);

  if (url.searchParams.get("mode") === "snapshot") {
    const events = await listRunEvents(runId, resumeAfter);
    return Response.json({ events, lastSeq: events.at(-1)?.seq ?? resumeAfter }, { headers: { "cache-control": "no-store" } });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = resumeAfter;
      const enqueue = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try { controller.close(); } catch { /* the request may already be gone */ }
      };
      const poll = async () => {
        if (closed || request.signal.aborted) { close(); return; }
        try {
          const events = await listRunEvents(runId, lastSeq, 250);
          for (const event of events) {
            lastSeq = Math.max(lastSeq, event.seq);
            enqueue(`id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`);
            if (event.payload.type === "run.succeeded" || event.payload.type === "run.failed" || event.payload.type === "run.cancelled") {
              close();
              return;
            }
          }
          if (events.length === 0) enqueue(": keep-alive\n\n");
          timer = setTimeout(() => void poll(), events.length === 250 ? 0 : 900);
        } catch (error) {
          enqueue(`event: stream-error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Event stream failed." })}\n\n`);
          timer = setTimeout(() => void poll(), 2_000);
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      void poll();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
