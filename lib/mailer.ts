import { connect as tlsConnect, TLSSocket } from "tls";
import { connect as netConnect, Socket } from "net";
import { randomBytes } from "crypto";
import { hostname } from "os";

/**
 * Sending mail.
 *
 * Azure App Service blocks outbound SMTP - 25 always, 465 and 587 on most
 * plans - so a direct connection to mail.lareo.ai times out from production no
 * matter how the mailbox is configured. Delivery therefore goes over HTTPS on
 * 443, which nothing blocks.
 *
 * Two transports, chosen by which variables are set:
 *   RESEND_API_KEY   -> HTTPS. This is what production uses.
 *   SMTP_HOST/USER/PASSWORD -> direct SMTP. Kept because it works from a local
 *                      machine and needs no third party to test against.
 *
 * Still dependency-free. update.ps1 does not copy package.json, so an archive
 * cannot deliver an npm package; fetch and node:tls are both built in.
 */

const CRLF = "\r\n";
const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 20_000;
const HTTP_TIMEOUT_MS = 15_000;

const FROM_NAME = "AI Investment Committee";

export type SendResult = { ok: true; id?: string } | { ok: false; reason: string };

/* ----------------------------------------------------------- configuration */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** true = TLS from the first byte (465); false = plaintext then STARTTLS (587) */
  implicitTls: boolean;
};

export type HttpConfig = { apiKey: string; from: string; endpoint: string };

export function httpConfig(): HttpConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    from: process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? "no-reply.aic@lareo.ai",
    endpoint: process.env.RESEND_API_URL ?? "https://api.resend.com/emails"
  };
}

export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  if (!host || !user || !password) return null;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const mode = process.env.SMTP_SECURE;   // "implicit" | "starttls"; normally left unset
  return {
    host,
    port,
    user,
    password,
    from: process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? user,
    implicitTls: mode ? mode === "implicit" : port === 465
  };
}

/** Kept for callers that only need to know whether mail can be sent at all. */
export const mailerConfigured = (): boolean => httpConfig() !== null || smtpConfig() !== null;

export const transportName = (): "https" | "smtp" | "none" =>
  httpConfig() ? "https" : smtpConfig() ? "smtp" : "none";

const validAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

/* ------------------------------------------------------------------- HTTPS */

async function sendOverHttp(config: HttpConfig, to: string, subject: string, text: string): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${config.from}>`,
        to: [to],
        subject,
        text
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      // The body names the problem - unverified domain, bad key - but can quote
      // the recipient back, so it is trimmed and never logged whole.
      const detail = (await response.text().catch(() => "")).slice(0, 300).replace(to, "<recipient>");
      return { ok: false, reason: `http ${response.status}: ${detail}` };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    return { ok: false, reason: reason === "The operation was aborted." ? "http request timed out" : reason };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------- SMTP */

/** Reads SMTP replies, which may span several lines: "250-FIRST" then "250 LAST". */
class ReplyReader {
  private buffer = "";
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;

  push(chunk: string): void {
    this.buffer += chunk;
    if (!this.waiting) return;   // leave it in the buffer rather than dropping it
    const reply = this.take();
    if (reply) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting.resolve(reply);
    }
  }

  fail(error: Error): void {
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting.reject(error);
    }
  }

  next(): Promise<Reply> {
    const ready = this.take();
    if (ready) return Promise.resolve(ready);
    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  private take(): Reply | null {
    const lines = this.buffer.split(CRLF);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // A final line is "NNN text"; continuation lines are "NNN-text".
      if (/^\d{3} /.test(line)) {
        const consumed = lines.slice(0, i + 1);
        this.buffer = lines.slice(i + 1).join(CRLF);
        return { code: Number(line.slice(0, 3)), text: consumed.join(" ") };
      }
    }
    return null;
  }
}

type Reply = { code: number; text: string };

class SmtpError extends Error {
  constructor(public stage: string, public code: number, text: string) {
    super(`SMTP ${stage} failed (${code}): ${text.slice(0, 200)}`);
    this.name = "SmtpError";
  }
}

function openSocket(config: SmtpConfig): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const implicitTls = config.implicitTls;
    const socket = implicitTls
      ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
      : netConnect({ host: config.host, port: config.port });

    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => onError(new Error("SMTP connection timed out")));
    socket.once("error", onError);
    socket.once(implicitTls ? "secureConnect" : "connect", () => {
      socket.setTimeout(COMMAND_TIMEOUT_MS);
      socket.removeListener("error", onError);
      resolve(socket);
    });
  });
}

function upgrade(socket: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: host }, () => resolve(secure));
    secure.once("error", reject);
  });
}

/** Escapes a leading dot, which SMTP would otherwise read as end of message. */
const dotStuff = (body: string) => body.split(CRLF).map((l) => (l.startsWith(".") ? `.${l}` : l)).join(CRLF);

const encodeBody = (text: string) =>
  (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join(CRLF);

function buildMessage(config: SmtpConfig, to: string, subject: string, text: string): string {
  const id = `${randomBytes(12).toString("hex")}@${config.from.split("@")[1] ?? "localhost"}`;
  const headers = [
    `From: ${FROM_NAME} <${config.from}>`,
    `To: <${to}>`,
    `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated"
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${encodeBody(text.replace(/\n/g, CRLF))}`;
}

async function sendOverSmtp(config: SmtpConfig, to: string, subject: string, text: string): Promise<SendResult> {
  let socket: Socket | TLSSocket | null = null;
  const reader = new ReplyReader();

  const say = async (line: string, stage: string, expected: number[]): Promise<Reply> => {
    socket!.write(`${line}${CRLF}`);
    const reply = await reader.next();
    if (!expected.includes(reply.code)) throw new SmtpError(stage, reply.code, reply.text);
    return reply;
  };

  try {
    socket = await openSocket(config);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => reader.push(chunk));
    socket.on("error", (error: Error) => reader.fail(error));
    socket.on("timeout", () => reader.fail(new Error("SMTP timed out")));
    socket.on("close", () => reader.fail(new Error("SMTP connection closed")));

    const greeting = await reader.next();
    if (greeting.code !== 220) throw new SmtpError("greeting", greeting.code, greeting.text);

    const me = hostname() || "aic";
    await say(`EHLO ${me}`, "EHLO", [250]);

    if (!config.implicitTls) {
      await say("STARTTLS", "STARTTLS", [220]);
      const secure = await upgrade(socket as Socket, config.host);
      socket = secure;
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => reader.push(chunk));
      socket.on("error", (error: Error) => reader.fail(error));
      await say(`EHLO ${me}`, "EHLO (TLS)", [250]);
    }

    await say("AUTH LOGIN", "AUTH", [334]);
    await say(Buffer.from(config.user, "utf8").toString("base64"), "AUTH user", [334]);
    await say(Buffer.from(config.password, "utf8").toString("base64"), "AUTH password", [235]);

    await say(`MAIL FROM:<${config.from}>`, "MAIL FROM", [250]);
    await say(`RCPT TO:<${to}>`, "RCPT TO", [250, 251]);
    await say("DATA", "DATA", [354]);

    socket.write(`${dotStuff(buildMessage(config, to, subject, text))}${CRLF}.${CRLF}`);
    const stored = await reader.next();
    if (stored.code !== 250) throw new SmtpError("message", stored.code, stored.text);

    socket.write(`QUIT${CRLF}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "unknown" };
  } finally {
    try {
      socket?.destroy();
    } catch {
      /* already gone */
    }
  }
}

/* ----------------------------------------------------------------- sending */

/**
 * Sends one message. Never throws: callers are user-facing routes that must not
 * expose mail-server detail, so failures come back as a reason string to log.
 * The recipient address stays out of the log either way.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<SendResult> {
  if (!validAddress(to)) return { ok: false, reason: "invalid_recipient" };

  const http = httpConfig();
  const smtp = smtpConfig();
  if (!http && !smtp) return { ok: false, reason: "mail_not_configured" };

  const result = http
    ? await sendOverHttp(http, to, subject, text)
    : await sendOverSmtp(smtp!, to, subject, text);

  // "in" narrows under a non-strict tsconfig too, unlike a check on result.ok.
  if ("reason" in result) console.error(`[mailer] ${transportName()}:`, result.reason);
  return result;
}
