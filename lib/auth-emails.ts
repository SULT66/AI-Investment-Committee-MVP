import { RESET_TOKEN_MINUTES, VERIFY_TOKEN_HOURS } from "@/lib/accounts";
import { sendMail } from "@/lib/mailer";

/**
 * The two transactional messages AIC sends.
 *
 * Plain text on purpose. A password-reset mail that renders as a styled button
 * is the same shape as every phishing attempt people are told to distrust; a
 * visible, checkable URL is easier to trust and harder to spoof convincingly.
 */

const CONTACT = process.env.AIC_CONTACT_EMAIL ?? "aic@lareo.ai";

/** Prefers the configured origin, falls back to the proxy headers Azure sets. */
export function baseUrl(request: Request): string {
  const configured = process.env.AIC_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "aic.lareo.ai";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function sendResetEmail(to: string, token: string, origin: string) {
  const link = `${origin}/reset?token=${token}`;
  return sendMail(
    to,
    "Reset your AI Investment Committee password",
    [
      "Someone asked to reset the password for this email address at AI Investment Committee.",
      "",
      "Open this link to choose a new one:",
      link,
      "",
      `The link works once and expires in ${RESET_TOKEN_MINUTES} minutes.`,
      "",
      "If this was not you, no action is needed - the password has not changed, and",
      "the link can be ignored.",
      "",
      `Questions: ${CONTACT}`,
      "",
      "AI Investment Committee - research and decision support, not investment advice."
    ].join("\n")
  );
}

export async function sendVerifyEmail(to: string, token: string, origin: string) {
  const link = `${origin}/api/v1/auth/verify?token=${token}`;
  return sendMail(
    to,
    "Confirm your email for AI Investment Committee",
    [
      "Welcome to AI Investment Committee.",
      "",
      "Confirm this address so you can recover the account if you ever lose the password:",
      link,
      "",
      `The link expires in ${VERIFY_TOKEN_HOURS} hours. You can keep using AIC in the meantime.`,
      "",
      "If you did not create this account, ignore this message.",
      "",
      `Questions: ${CONTACT}`,
      "",
      "AI Investment Committee - research and decision support, not investment advice."
    ].join("\n")
  );
}
