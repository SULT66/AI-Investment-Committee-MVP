import { getEvents, getSession, subscribe, isTerminal } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-sent events for one session.
 *
 * Reconnect: pass ?after=<lastSequence> (or the standard Last-Event-ID header)
 * and every missed event is replayed before the live stream resumes.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getSession(id)) {
    return new Response(JSON.stringify({ error: { code: "SESSION_NOT_FOUND" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(request.url);
  const headerId = Number(request.headers.get("last-event-id"));
  const queryAfter = Number(url.searchParams.get("after"));
  const after = Number.isFinite(headerId) && headerId > 0 ? headerId
    : Number.isFinite(queryAfter) && queryAfter > 0 ? queryAfter : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (evt: { event: string; sequence: number }) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${evt.sequence}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // 1. replay whatever the client missed
      for (const evt of getEvents(id, after)) send(evt);

      // 2. if the session already finished, close cleanly
      const snapshot = getSession(id);
      if (snapshot && isTerminal(snapshot.status)) {
        controller.close();
        return;
      }

      // 3. live stream
      const unsubscribe = subscribe(id, (evt) => {
        send(evt);
        const snap = getSession(id);
        if (snap && isTerminal(snap.status)) {
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        }
      });

      // keep proxies from dropping an idle connection
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { closed = true; }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
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
