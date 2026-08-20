import { fetchWithTimeout } from "./fetch-timeout";
import { record } from "./telemetry";

/**
 * Which model answers for which seat.
 *
 * Seven personas driven by one model are not seven analysts. They share a
 * training set, a tokeniser and a set of blind spots, so they are wrong together.
 * When six of them agree, that is not six independent confirmations - it is one
 * model saying the same thing in six voices, and the confidence score treats it
 * as agreement worth 35% of the total.
 *
 * The cheapest real fix is to put the seats that exist to disagree on a
 * different model from a different vendor. A Devil's Advocate drawing on the
 * same weights as the members it is arguing against is theatre; one that does
 * not is an actual second opinion.
 *
 * Configured per seat, by environment variable, so this can be turned on one
 * seat at a time and measured:
 *
 *   AIC_MODEL_DEVILS_ADVOCATE=anthropic:claude-sonnet-4-5
 *   AIC_MODEL_RISK=anthropic:claude-sonnet-4-5
 *   AIC_MODEL_DEFAULT=openai:gpt-5-mini
 *
 * With nothing set, every seat uses the existing OpenAI model and behaviour is
 * exactly as before.
 */

export type Provider = "openai" | "anthropic";
export type ModelChoice = { provider: Provider; model: string };

const DEFAULT_OPENAI = process.env.COMMITTEE_MODEL ?? "gpt-5-mini";

function parse(spec: string | undefined): ModelChoice | null {
  if (!spec) return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;

  const [head, ...rest] = trimmed.split(":");
  const tail = rest.join(":");
  if (head === "anthropic" && tail) return { provider: "anthropic", model: tail };
  if (head === "openai" && tail) return { provider: "openai", model: tail };
  // A bare name is OpenAI, so COMMITTEE_MODEL keeps working unchanged.
  return { provider: "openai", model: trimmed };
}

export function modelForAgent(agentKey: string): ModelChoice {
  const specific = parse(process.env[`AIC_MODEL_${agentKey.toUpperCase()}`]);
  if (specific) return specific;
  const fallback = parse(process.env.AIC_MODEL_DEFAULT);
  if (fallback) return fallback;
  return { provider: "openai", model: DEFAULT_OPENAI };
}

/** How many distinct models produced this committee's opinions. */
export function distinctModels(agentKeys: string[]): number {
  return new Set(agentKeys.map((k) => `${modelForAgent(k).provider}:${modelForAgent(k).model}`)).size;
}

export type ModelCall = {
  prompt: string;
  schema: unknown;
  schemaName: string;
  webSearch: boolean;
  timeoutMs: number;
  agentKey: string;
};

export type ModelResult = {
  parsed: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  choice: ModelChoice;
};

async function callOpenAI(call: ModelCall, choice: ModelChoice): Promise<ModelResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: choice.model,
    input: call.prompt,
    text: {
      format: { type: "json_schema", name: call.schemaName, strict: true, schema: call.schema }
    }
  };
  if (call.webSearch && process.env.COMMITTEE_WEB_SEARCH !== "0") {
    body.tools = [{ type: "web_search", search_context_size: "low" }];
  }

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    call.timeoutMs,
    `Agent ${call.schemaName}`
  );
  if (!res.ok) throw new Error(`${call.schemaName} upstream ${res.status}`);

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text =
    data.output_text ??
    data.output?.flatMap((i) => i.content ?? []).find((p) => p.type === "output_text")?.text;
  if (!text) throw new Error(`${call.schemaName} returned no text`);

  return {
    parsed: JSON.parse(text) as Record<string, unknown>,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    choice
  };
}

/**
 * Anthropic has no strict JSON-schema mode, so the schema goes in the prompt and
 * the reply is parsed defensively. Models wrap JSON in prose or fences often
 * enough that assuming clean output would make this fail intermittently, which
 * is the worst way for it to fail.
 */
async function callAnthropic(call: ModelCall, choice: ModelChoice): Promise<ModelResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const instruction =
    `${call.prompt}\n\n` +
    `Reply with JSON only - no prose, no markdown fences - matching this schema exactly:\n` +
    `${JSON.stringify(call.schema)}`;

  const res = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: choice.model,
        max_tokens: 2000,
        messages: [{ role: "user", content: instruction }]
      })
    },
    call.timeoutMs,
    `Agent ${call.schemaName}`
  );
  if (!res.ok) throw new Error(`${call.schemaName} upstream ${res.status}`);

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  if (!text) throw new Error(`${call.schemaName} returned no text`);

  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`${call.schemaName} returned no JSON object`);

  return {
    parsed: JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    choice
  };
}

/**
 * One retry, and only on a timeout.
 *
 * Three of four sessions lost a member to AGENT_TIMEOUT once the prompts grew:
 * methods, company financials and source disagreements all landed in the same
 * context, session time went from a median of 104s to 198s, and the tail of the
 * distribution started hitting the ceiling. A seat that times out is usually
 * unlucky rather than broken - it answers on the second attempt.
 *
 * Retried only on timeout, deliberately. A 400 means the request is wrong and
 * will be wrong again; a 429 wants backoff rather than an immediate repeat; a
 * schema failure repeats identically. Retrying those spends money to receive the
 * same answer.
 *
 * The second attempt gets a shorter budget, so one slow seat cannot double the
 * length of the meeting.
 */
export async function callAgentModel(call: ModelCall): Promise<ModelResult> {
  const choice = modelForAgent(call.agentKey);
  const attempts = process.env.AIC_AGENT_RETRY === "0" ? 1 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    const timeoutMs = attempt === 1 ? call.timeoutMs : Math.round(call.timeoutMs * 0.6);

    try {
      const result =
        choice.provider === "anthropic"
          ? await callAnthropic({ ...call, timeoutMs }, choice)
          : await callOpenAI({ ...call, timeoutMs }, choice);
      void record({
        kind: "provider.call",
        provider: choice.provider,
        durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      lastError = error;
      const timedOut = error instanceof Error && error.name === "UpstreamTimeoutError";
      void record({
        kind: "provider.failed",
        provider: choice.provider,
        code: timedOut ? "TIMEOUT" : error instanceof Error ? error.message.slice(0, 40) : "unknown",
        durationMs: Date.now() - started
      });
      if (!timedOut || attempt === attempts) throw error;
      console.error(`[model-router] ${call.agentKey} timed out, retrying once`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("model call failed");
}
