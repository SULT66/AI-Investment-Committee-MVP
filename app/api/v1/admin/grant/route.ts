import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { findAccountByEmail } from "@/lib/accounts";
import { grantReviews } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email().max(200),
  units: z.number().int().min(1).max(100),
  reason: z.string().trim().min(3).max(200)
});

/** Adds reviews to one account's allowance, recorded against the administrator who did it. */
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Give an email, a number of reviews between 1 and 100, and a reason."
        }
      },
      { status: 400 }
    );
  }

  const account = await findAccountByEmail(input.email);
  if (!account) {
    // Unlike the public forms, this one may say so: the administrator already
    // has the account list, so hiding it would only waste their time.
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No account with that email." } },
      { status: 404 }
    );
  }

  const entitlement = await grantReviews(
    account.id,
    input.units,
    `granted by ${admin.email}: ${input.reason}`
  );

  // The audit trail is the ledger entry itself, which names the administrator
  // and the reason. Telemetry only carries typed session events.

  return NextResponse.json({
    email: account.email,
    allowance: entitlement.allowance,
    used: entitlement.used,
    remaining: entitlement.remaining
  });
}
