import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  language: z.string().trim().min(2).max(10),
  member: z.enum(["chairman", "fundamental", "market", "risk", "portfolio"])
});

const voiceByMember = {
  chairman: "cedar",
  fundamental: "sage",
  market: "coral",
  risk: "onyx",
  portfolio: "marin"
} as const;

const styleByMember = {
  chairman: "Speak with calm authority, measured pacing, and the gravitas of an experienced chief investment officer.",
  fundamental: "Speak analytically and thoughtfully, with precise diction and a restrained professional tone.",
  market: "Speak clearly with slightly more energy, like an experienced market strategist presenting live conditions.",
  risk: "Speak cautiously, firmly, and deliberately, emphasizing downside risks without sounding alarmist.",
  portfolio: "Speak in a composed advisory tone, focused on balance, allocation, and the client's full portfolio."
} as const;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Natural voice is not configured" }, { status: 503 });
    }

    const input = requestSchema.parse(await request.json());
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: voiceByMember[input.member],
        input: input.text,
        instructions: `${styleByMember[input.member]} Speak naturally in language locale ${input.language}. Do not translate or add words.`,
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenAI speech request failed", response.status, detail);
      return NextResponse.json({ error: "Unable to generate natural voice" }, { status: 502 });
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400"
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid voice request", details: error.flatten() }, { status: 400 });
    }
    console.error("Voice route error", error);
    return NextResponse.json({ error: "Unable to generate voice" }, { status: 500 });
  }
}
