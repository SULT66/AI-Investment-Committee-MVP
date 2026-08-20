"use client";

import { useEffect, useRef, useState } from "react";
import "./assistant.css";

/**
 * The conversation panel.
 *
 * Two modes, and which one is the default is the whole point. Ask Committee gets
 * seven specialists answering from seven corners, which is exactly right for
 * "what does PEG 2.93 imply here" and exactly wrong for "wait, why do they
 * disagree" - nobody in that room is responsible for the whole picture.
 *
 * So the assistant answers first, in plain words, and the committee is one
 * button away. When the assistant judges that a question needs fresh analysis
 * rather than explanation it says so and offers that button, rather than
 * improvising an answer it has no standing to give.
 *
 * The panel is mounted on the report page as well as the Live Desk. It was only
 * ever on the desk, so anybody arriving at a report from their history, the
 * dashboard or an alert email had no way to ask anything about it.
 */

type Turn = {
  id: number;
  who: "you" | "assistant" | string;
  text: string;
  state: "waiting" | "done" | "quiet" | "failed";
  needsCommittee?: boolean;
};

const COMMITTEE_ORDER = [
  "fundamental", "market", "quant", "risk", "macro", "devils_advocate", "chairman"
];

const MEMBER_NAMES: Record<string, string> = {
  fundamental: "Fundamental Agent",
  market: "Market Agent",
  quant: "Quant Agent",
  risk: "Risk Agent",
  macro: "Macro Agent",
  devils_advocate: "Devil's Advocate",
  chairman: "Chairman"
};

export function AssistantPanel({
  sessionId,
  subject,
  onClose
}: {
  sessionId: string;
  subject: string;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<"assistant" | "committee">("assistant");
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  const history = () =>
    thread
      .filter((t) => t.who === "you" || t.who === "assistant")
      .filter((t) => t.state === "done")
      .map((t) => ({ role: t.who === "you" ? ("user" as const) : ("assistant" as const), text: t.text }));

  async function askAssistant(text: string) {
    const askId = nextId.current;
    nextId.current += 2;

    const priorHistory = history();
    setThread((t) => [
      ...t,
      { id: askId, who: "you", text, state: "done" },
      { id: askId + 1, who: "assistant", text: "", state: "waiting" }
    ]);

    try {
      const res = await fetch("/api/v1/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          sessionId,
          history: priorHistory,
          language: document.documentElement.lang || "en"
        })
      });

      if (res.status === 429) {
        const body = (await res.json()) as { error?: { message?: string } };
        setNotice(body.error?.message ?? "Too many questions just now.");
        setThread((t) => t.map((x) => (x.id === askId + 1 ? { ...x, state: "failed" } : x)));
        return;
      }
      if (!res.ok) {
        setThread((t) => t.map((x) => (x.id === askId + 1 ? { ...x, state: "failed" } : x)));
        setNotice("The assistant could not answer just now.");
        return;
      }

      const data = (await res.json()) as {
        answer: string; needsCommittee: boolean; suggestion: string;
      };
      setThread((t) =>
        t.map((x) =>
          x.id === askId + 1
            ? {
                ...x,
                text: data.answer + (data.needsCommittee && data.suggestion ? `\n\n${data.suggestion}` : ""),
                state: "done",
                needsCommittee: data.needsCommittee
              }
            : x
        )
      );
    } catch {
      setThread((t) => t.map((x) => (x.id === askId + 1 ? { ...x, state: "failed" } : x)));
      setNotice("Could not reach the server.");
    }
  }

  /* Seven requests in parallel, one per seat, each bubble filling as its member
     finishes. Answering them in one call would mean waiting for the slowest
     anyway, and Azure buffers SSE so a server-side stream arrives in one lump. */
  async function askCommittee(text: string) {
    const askId = nextId.current;
    nextId.current += 1 + COMMITTEE_ORDER.length;

    setThread((t) => [
      ...t,
      { id: askId, who: "you", text, state: "done" },
      ...COMMITTEE_ORDER.map((key, i) => ({
        id: askId + 1 + i,
        who: MEMBER_NAMES[key] ?? key,
        text: "",
        state: "waiting" as const
      }))
    ]);

    await Promise.all(
      COMMITTEE_ORDER.map(async (member, i) => {
        const id = askId + 1 + i;
        try {
          const res = await fetch(`/api/v1/sessions/${sessionId}/questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: text, member })
          });
          if (res.status === 429) {
            const body = (await res.json()) as { error?: { message?: string } };
            setNotice(body.error?.message ?? "Too many questions just now.");
            setThread((t) => t.map((x) => (x.id === id ? { ...x, state: "failed" } : x)));
            return;
          }
          if (!res.ok) {
            setThread((t) => t.map((x) => (x.id === id ? { ...x, state: "failed" } : x)));
            return;
          }
          const data = (await res.json()) as { turns?: Array<{ text: string }>; canAnswer?: boolean };
          const answer = data.turns?.[0]?.text ?? "";
          setThread((t) =>
            t.map((x) =>
              x.id === id
                ? {
                    ...x,
                    text: answer,
                    state: answer ? (data.canAnswer === false ? "quiet" : "done") : "failed"
                  }
                : x
            )
          );
        } catch {
          setThread((t) => t.map((x) => (x.id === id ? { ...x, state: "failed" } : x)));
        }
      })
    );
  }

  async function send() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice("");
    setQuestion("");
    if (mode === "assistant") await askAssistant(text);
    else await askCommittee(text);
    setBusy(false);
  }

  const visible = thread.filter((t) => t.state !== "failed" || busy);
  const lastNeedsCommittee = [...thread].reverse().find((t) => t.who === "assistant")?.needsCommittee;

  return (
    <div className="asst">
      <header className="asstHead">
        <div className="asstModes" role="group" aria-label="Who answers">
          <button
            className={mode === "assistant" ? "on" : ""}
            onClick={() => setMode("assistant")}
            aria-pressed={mode === "assistant"}
          >
            Assistant
          </button>
          <button
            className={mode === "committee" ? "on" : ""}
            onClick={() => setMode("committee")}
            aria-pressed={mode === "committee"}
          >
            Ask the committee
          </button>
        </div>
        {onClose && <button className="asstClose" onClick={onClose} aria-label="Close">✕</button>}
      </header>

      <div className="asstThread">
        {!thread.length && (
          <p className="asstHint">
            {mode === "assistant"
              ? `Ask anything about ${subject} — why the members disagreed, what a figure means, how it sits with what you already hold. The assistant explains the committee's findings; it does not add a view of its own.`
              : `Ask once and every member answers from their own angle. Follow-up questions are free — they do not consume another review.`}
          </p>
        )}

        {visible.map((m) => (
          <div
            key={m.id}
            className={
              m.who === "you"
                ? "asstMine"
                : m.state === "quiet"
                  ? "asstTheirs asstQuiet"
                  : "asstTheirs"
            }
          >
            <small>{m.who === "you" ? "You" : m.who === "assistant" ? "Lareo assistant" : m.who}</small>
            {m.state === "waiting" ? (
              <p className="asstWaiting" aria-label="thinking"><span /><span /><span /></p>
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        ))}

        {lastNeedsCommittee && mode === "assistant" && (
          <button className="asstHandoff" onClick={() => setMode("committee")}>
            Put this to the committee instead
          </button>
        )}

        {notice && <p className="asstHint">{notice}</p>}
        <div ref={bottom} />
      </div>

      <div className="asstInput">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder={
            mode === "assistant" ? "Why did the Risk Agent disagree?" : "Ask all seven members"
          }
          maxLength={500}
          disabled={busy}
        />
        <button onClick={() => void send()} disabled={busy || !question.trim()}>
          {busy ? "…" : "Ask"}
        </button>
      </div>

      <p className="asstFoot">
        Research and decision support. Nothing here is investment advice, and no answer will tell you
        what to do with your money.
      </p>
    </div>
  );
}
