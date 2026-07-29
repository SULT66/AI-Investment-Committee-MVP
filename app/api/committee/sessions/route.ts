import { NextResponse } from "next/server";
import { z } from "zod";
import { runDemoCommittee } from "@/lib/decision-engine";

const requestSchema = z.object({
  ticker: z.string().trim().min(1).max(8),
  amount: z.number().positive(),
  portfolioValue: z.number().positive(),
  currentSectorExposure: z.number().min(0).max(100),
  riskTolerance: z.enum(["low", "moderate", "high"]),
  horizonYears: z.number().int().min(1).max(50),
  language: z.enum(["en", "ru", "es", "fr", "de", "it", "pt", "ar", "tr", "az"]).default("en")
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return NextResponse.json(runDemoCommittee(input), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    return NextResponse.json({ error: "Unable to run committee" }, { status: 500 });
  }
}
