import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { notifyPaymentHeld } from "./notify";
import { buyerTokenFor, hasOrderLinkSecret } from "./order-links";
import { createAdminClient } from "./supabase/admin";
import type { OrderStatus } from "./types";

/** 4-digit code the buyer hands over on delivery. Random, so it can't be predicted. */
export function newDeliveryCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

export const DELIVERY_CODE_RESULT: Record<string, string> = {
  released: "Code accepted. The order is complete and your payout is on its way.",
  wrong: "That code is wrong. Ask the buyer to read it from their order page.",
  locked: "Too many wrong codes, so code entry is locked for this order. The buyer can still confirm on their order page.",
  no_code: "This order has no delivery code. Ask the buyer to confirm on their order page.",
  not_open: "This order is already completed or disputed.",
  not_found: "Order not found.",
  format: "Enter the buyer's 4-digit code.",
  error: "Something went wrong. Try again.",
};

/**
 * The buyer has no account; their order link carries a secret token. We store only its hash.
 * With ORDER_LINK_SECRET set, the token is derived from the order id so the server can
 * rebuild the link for WhatsApp messages; otherwise it's random.
 */
export function newBuyerToken(orderId: string) {
  const token = hasOrderLinkSecret() ? buyerTokenFor(orderId) : randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, hash: string | null) {
  if (!hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Moves an order from "waiting for payment" to "held", but only if Paystack says
 * the right amount in naira was paid. Safe to call more than once (webhook + page visit).
 */
export async function markOrderPaid(reference: string, amountKobo: number, currency: string) {
  if (currency !== "NGN") return { ok: false as const, reason: "wrong currency" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .update({ status: "held", paid_at: new Date().toISOString() })
    .eq("payment_ref", reference)
    .eq("status", "pending_payment")
    .eq("total_kobo", amountKobo)
    .select("id");
  if (error) return { ok: false as const, reason: error.message };
  const changed = (data ?? []).length > 0;
  // Only the call that actually moved the order to "held" sends the WhatsApp messages.
  if (changed) await notifyPaymentHeld(data![0].id);
  return { ok: true as const, changed };
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Waiting for payment",
  held: "Paid · money held",
  shipped: "Shipped",
  delivered: "Delivered",
  released: "Completed · seller paid",
  disputed: "Disputed · money frozen",
  refunded: "Refunded",
};

export const STATUS_TONE: Record<OrderStatus, "ok" | "indigo" | "kola" | "warn"> = {
  pending_payment: "warn",
  held: "indigo",
  shipped: "indigo",
  delivered: "indigo",
  released: "ok",
  disputed: "kola",
  refunded: "warn",
};

export const DISPUTE_REASONS = ["It never arrived", "Not what was shown", "It arrived damaged", "Something else"] as const;
