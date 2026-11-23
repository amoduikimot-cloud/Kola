import { createHmac } from "node:crypto";

/**
 * The buyer's private order link is /order/<id>/<token>.
 * The token is derived from the order id with a server secret (ORDER_LINK_SECRET), so the
 * server can rebuild the link later, for example to put in a WhatsApp message, without
 * storing it. The database still stores only a hash of it.
 */
export const hasOrderLinkSecret = () => (process.env.ORDER_LINK_SECRET ?? "").length >= 16;

export function buyerTokenFor(orderId: string): string {
  const secret = process.env.ORDER_LINK_SECRET ?? "";
  if (secret.length < 16) throw new Error("ORDER_LINK_SECRET must be set (16+ characters)");
  return createHmac("sha256", secret).update(`order-link:${orderId}`).digest("base64url").slice(0, 32);
}

/** "<id>/<token>", the part after /order/. */
export function buyerOrderPath(orderId: string): string {
  return `${orderId}/${buyerTokenFor(orderId)}`;
}
