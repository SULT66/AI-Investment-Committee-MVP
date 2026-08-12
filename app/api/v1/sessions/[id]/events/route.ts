import { getEvents, getSession, isTerminal } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-sent events for one session.
 *
 * The store is file-backed, so this polls for new sequence numbers rather than
 * subscribing in-process. That costs a little latency but means a client can
 * follow a session that is being produced by a different instance.
 *
 * Reconnect: pass ?after=<lastSequence> or the standard Last-Event-ID header and
 * everything missed is replayed before the live stream resumes.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const initial = await getSession(id);
  if (!initial) {
    return new Response(JSON.stringify({ error: { code: "SESSION_NOT_FOUND" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(request.url);
  const headerId = Number(request.headers.get("last-event-id"));
  const queryAfter = Number(url.searchParams.get("after"));
  const startAfter =
    Number.isFinite(headerId) && headerId > 0 ? headerId
    : Number.isFinite(queryAfter) && queryAfter > 0 ? queryAfter
    : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let cursor = startAfter;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = (evt: { event: string; sequence: number }) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              "id: " + evt.sequence + "\nevent: " + evt.event + "\ndata: " + JSON.stringify(evt) + "\n\n"
            )
          );
        } catch {
          closed = true;
        }
      };

      const drain = async () => {
        if (closed) return;
        try {
          const pending = await getEvents(id, cursor);
          for (const evt of pending) {
            send(evt);
            cursor = Math.max(cursor, evt.sequence);
          }
          const snapshot = await getSession(id);
          if (!snapshot || isTerminal(snapshot.status)) close();
        } catch {
          /* a transient read failure should not kill the stream */
        }
      };

      const poll = setInterval(() => { void drain(); }, 800);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { closed = true; }
      }, 15000);

      request.signal.addEventListener("abort", close);

      await drain();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
