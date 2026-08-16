import { connect as tlsConnect, TLSSocket } from "tls";
import { connect as netConnect, Socket } from "net";
import { randomBytes } from "crypto";
import { hostname } from "os";

/**
 * A small SMTP client.
 *
 * Deliberately dependency-free. update.ps1 copies app/ lib/ components/ public/
 * docs/ and the root config files - it does not copy package.json - so a new
 * npm dependency cannot be delivered by an archive. Node's own tls module can
 * speak SMTP well enough for two transactional messages.
 *
 * Supports implicit TLS (port 465) and STARTTLS (port 587). Bluehost accepts
 * both on mail.lareo.ai; 465 is the default here because there is no plaintext
 * window at all.
 *
 * Nothing here logs the password, the message body, or the recipient address.
 */

const CRLF = "\r\n";
const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 20_000;

export type MailerConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  /** true = TLS from the first byte (465); false = plaintext then STARTTLS (587) */
  implicitTls: boolean;
};

export function mailerConfig(): MailerConfig | null {
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
    from: process.env.SMTP_FROM ?? user,
    implicitTls: mode ? mode === "implicit" : port === 465
  };
}

export const mailerConfigured = (): boolean => mailerConfig() !== null;

/** Reads SMTP replies, which may span several lines: "250-FIRST" then "250 LAST". */
class ReplyReader {
  private buffer = "";
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;

  push(chunk: string): void {
    this.buffer += chunk;
    const reply = this.take();
    if (reply && this.waiting) {
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

function openSocket(config: MailerConfig): Promise<Socket | TLSSocket> {
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

function buildMessage(config: MailerConfig, to: string, subject: string, text: string): string {
  const id = `${randomBytes(12).toString("hex")}@${config.from.split("@")[1] ?? "localhost"}`;
  const headers = [
    `From: AI Investment Committee <${config.from}>`,
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

export type SendResult = { ok: true } | { ok: false; reason: string };

/**
 * Sends one message. Never throws: callers are user-facing routes that must not
 * expose mail-server detail, so failures come back as a reason string to log.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<SendResult> {
  const config = mailerConfig();
  if (!config) return { ok: false, reason: "smtp_not_configured" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return { ok: false, reason: "invalid_recipient" };

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
    const reason = error instanceof Error ? error.message : "unknown";
    // Recipient address stays out of the log.
    console.error("[mailer]", reason);
    return { ok: false, reason };
  } finally {
    try {
      socket?.destroy();
    } catch {
      /* already gone */
    }
  }
}
