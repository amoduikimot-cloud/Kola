import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Cloud API (Meta). Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 * This file has no app imports so its helpers can be tested on their own.
 */

const env = (k: string) => process.env[k] ?? "";
export const isWhatsAppConfigured = () => Boolean(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"));
const apiVersion = () => env("WHATSAPP_API_VERSION") || "v21.0";
export const templateLanguage = () => env("WHATSAPP_TEMPLATE_LANG") || "en";

/**
 * Turns what people type into WhatsApp's format: country code + number, digits only.
 * Nigerian local numbers (0803…) become 234803…. Numbers typed with "+" keep their country code.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") || raw.startsWith("00")) {
    const intl = raw.startsWith("00") ? digits.slice(2) : digits;
    return /^[1-9]\d{9,14}$/.test(intl) ? intl : null;
  }
  if (/^0[789][01]\d{8}$/.test(digits)) return "234" + digits.slice(1); // 0803 123 4567
  if (/^234[789][01]\d{8}$/.test(digits)) return digits; // 234803…
  if (/^[789][01]\d{8}$/.test(digits)) return "234" + digits; // 803… without the 0
  return null;
}

/**
 * WhatsApp template values can't contain new lines, tabs or more than 4 spaces in a row,
 * and they're limited in length. Clean anything that came from users.
 */
export function cleanParam(value: string, max = 200): string {
  const v = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (v.length > max ? v.slice(0, max - 1) + "…" : v) || "-";
}

export type ButtonParam =
  | { kind: "url"; index: number; suffix: string }
  | { kind: "reply"; index: number; payload: string };

/** Builds the API request body for a template message. */
export function templatePayload(to: string, template: string, body: string[], buttons: ButtonParam[] = []) {
  const components: unknown[] = [];
  if (body.length) components.push({ type: "body", parameters: body.map((text) => ({ type: "text", text: cleanParam(text) })) });
  for (const b of buttons) {
    components.push(
      b.kind === "url"
        ? { type: "button", sub_type: "url", index: String(b.index), parameters: [{ type: "text", text: b.suffix }] }
        : { type: "button", sub_type: "quick_reply", index: String(b.index), parameters: [{ type: "payload", payload: b.payload }] },
    );
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: template, language: { code: templateLanguage() }, components },
  };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Sends any message payload. Never throws. */
export async function sendWhatsApp(payload: unknown): Promise<SendResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/${apiVersion()}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    const id = json?.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, id };
    return { ok: false, error: json?.error?.message ?? `WhatsApp error ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * A plain text reply. WhatsApp only allows this within 24 hours of the person
 * messaging us (for example right after they tap a reply button).
 */
export function sendText(to: string, text: string) {
  return sendWhatsApp({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } });
}

/** Checks that an incoming webhook really came from Meta (X-Hub-Signature-256 = HMAC-SHA256 with the app secret). */
export function isValidMetaSignature(rawBody: string, header: string | null, appSecret = env("WHATSAPP_APP_SECRET")): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reply-button payloads look like "arrived:<order id>". */
export const REPLY_ACTIONS = ["arrived", "notyet", "problem", "rate5", "rate3", "rate1", "replace"] as const;
export type ReplyAction = (typeof REPLY_ACTIONS)[number];

export function parseReplyPayload(payload: string): { action: ReplyAction; orderId: string } | null {
  const m = /^([a-z0-9]+):([0-9a-f-]{36})$/i.exec(payload.trim());
  if (!m || !(REPLY_ACTIONS as readonly string[]).includes(m[1])) return null;
  return { action: m[1] as ReplyAction, orderId: m[2].toLowerCase() };
}

/** Pulls reply-button taps out of a WhatsApp webhook body. */
export function extractReplies(body: unknown): { from: string; payload: string; messageId: string }[] {
  const out: { from: string; payload: string; messageId: string }[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: { messages?: unknown[] } }[] }[]) {
    for (const change of entry.changes ?? []) {
      type IncomingMessage = {
        id?: string;
        from?: string;
        type?: string;
        button?: { payload?: string };
        interactive?: { button_reply?: { id?: string } };
      };
      for (const msg of (change.value?.messages ?? []) as IncomingMessage[]) {
        const payload =
          msg.type === "button" ? msg.button?.payload : msg.type === "interactive" ? msg.interactive?.button_reply?.id : undefined;
        if (typeof payload === "string" && typeof msg.from === "string") out.push({ from: msg.from, payload, messageId: String(msg.id ?? "") });
      }
    }
  }
  return out;
}

/** Dates in Lagos time, like "Wed 26 Nov, 8:00 am". */
export function lagosDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
