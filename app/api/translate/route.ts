import { NextRequest, NextResponse } from "next/server";

const languageNames: Record<string, string> = {
  en: "English",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ar: "Arabic",
  tr: "Turkish",
  az: "Azerbaijani"
};

export async function POST(request: NextRequest) {
  try {
    const { text, language } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const target = languageNames[language] ?? "English";
    if (language === "en") return NextResponse.json({ text });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `Translate the supplied investment-committee dialogue into ${target}. Return only the translated text. Preserve ticker symbols, numbers, currencies, percentages and financial terminology. Do not add explanations.`
          },
          { role: "user", content: text }
        ]
      })
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("Translation API error", response.status, details);
      return NextResponse.json({ text }, { status: 200 });
    }

    const data = await response.json();
    const translated = data?.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ text: translated || text });
  } catch (error) {
    console.error("Translation route error", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
