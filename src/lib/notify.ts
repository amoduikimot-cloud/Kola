import { formatNaira } from "./money";
import { buyerOrderPath, hasOrderLinkSecret } from "./order-links";
import { createAdminClient } from "./supabase/admin";
import { autoReleaseHours, formatWindow, trustScore } from "./trust";
import type { Order, Profile } from "./types";
import {
  isWhatsAppConfigured,
  lagosDate,
  normalizePhone,
  sendWhatsApp,
  templatePayload,
  type ButtonParam,
} from "./whatsapp";

/**
 * WhatsApp order messages. Each must be approved as a template in Meta first;
 * the exact wording to submit is in docs/whatsapp-templates.md.
 *
 * Rules:
 *  - A message is logged once per order (database unique key), so it's never sent twice.
 *  - Sending never breaks the order flow: errors are logged and retried by the daily job.
 *  - Buyers get messages only if they ticked the WhatsApp box at checkout.
 */
export const TEMPLATES = {
  paymentHeld: "kola_payment_held",
  shipped: "kola_order_shipped",
  arrivalCheck: "kola_arrival_check",
  complete: "kola_order_complete",
  newOrder: "kola_new_order",
  payoutSent: "kola_payout_sent",
  dispute: "kola_dispute_opened",
  disputeDecided: "kola_dispute_decided",
} as const;

type OrderRow = Order & {
  buyer_whatsapp_optin: boolean;
  delivery_code: string | null;
  profiles: Pick<Profile, "handle" | "display_name" | "completed_orders" | "id_verified" | "disputes_total" | "disputes_lost"> | null;
};

const shortRef = (id: string) => `KOLA-${id.slice(0, 4).toUpperCase()}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const buyerShort = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const { data } = await createAdminClient()
    .from("orders")
    .select("*, profiles(handle, display_name, completed_orders, id_verified, disputes_total, disputes_lost)")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  return data;
}

async function sellerPhone(sellerId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("seller_contacts")
    .select("whatsapp_phone")
    .eq("seller_id", sellerId)
    .maybeSingle<{ whatsapp_phone: string }>();
  return data?.whatsapp_phone ?? null;
}

function buyerPhone(o: OrderRow): string | null {
  return o.buyer_whatsapp_optin && o.buyer_phone ? normalizePhone(o.buyer_phone) : null;
}

/** Logs the message (once per order) and sends it. */
async function deliver(orderId: string, role: "buyer" | "seller", phone: string, template: string, body: string[], buttons: ButtonParam[] = []) {
  const admin = createAdminClient();
  const payload = templatePayload(phone, template, body, buttons);
  const { data: row, error } = await admin
    .from("notifications")
    .insert({ order_id: orderId, role, template, phone, payload })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error || !row) return; // already sent for this order (unique key), or the log is unavailable
  await attempt(row.id, payload);
}

async function attempt(notificationId: string, payload: unknown) {
  const admin = createAdminClient();
  const res = await sendWhatsApp(payload);
  const { data: current } = await admin.from("notifications").select("attempts").eq("id", notificationId).maybeSingle<{ attempts: number }>();
  const attempts = (current?.attempts ?? 0) + 1;
  await admin
    .from("notifications")
    .update(
      res.ok
        ? { status: "sent", wa_message_id: res.id, sent_at: new Date().toISOString(), attempts, last_error: null }
        : { status: "failed", attempts, last_error: res.error },
    )
    .eq("id", notificationId);
}

/** Wraps each event so a WhatsApp problem can never break payments or orders. */
function safely(name: string, fn: (orderId: string) => Promise<void>) {
  return async (orderId: string) => {
    if (!isWhatsAppConfigured()) return;
    try {
      await fn(orderId);
    } catch (e) {
      console.error(`[whatsapp] ${name} failed for order ${orderId}`, e);
    }
  };
}

const orderLinkButtons = (orderId: string): ButtonParam[] => [
  { kind: "url", index: 0, suffix: buyerOrderPath(orderId) },
  { kind: "url", index: 1, suffix: `${buyerOrderPath(orderId)}?dispute=1` },
];

// ---------------------------------------------------------------- buyer messages

export const notifyPaymentHeld = safely("payment held", async (orderId) => {
  const o = await loadOrder(orderId);
  if (!o || o.status !== "held") return;
  const seller = o.profiles?.display_name ?? "the seller";

  const phone = buyerPhone(o);
  if (phone && hasOrderLinkSecret() && o.delivery_code) {
    await deliver(o.id, "buyer", phone, TEMPLATES.paymentHeld,
      [firstName(o.buyer_name), formatNaira(o.total_kobo), seller, o.delivery_code],
      orderLinkButtons(o.id));
  }

  const sPhone = await sellerPhone(o.seller_id);
  if (sPhone) {
    await deliver(o.id, "seller", sPhone, TEMPLATES.newOrder, [
      buyerShort(o.buyer_name),
      o.items.map((i) => `${i.qty} × ${i.name}`).join(", "),
      formatNaira(o.subtotal_kobo + o.delivery_kobo),
      o.buyer_address ?? "-",
      o.buyer_phone ?? "-",
    ]);
  }
});

export const notifyShipped = safely("shipped", async (orderId) => {
  const o = await loadOrder(orderId);
  const phone = o && buyerPhone(o);
  if (!o || !phone || o.status !== "shipped" || !o.delivery_code || !o.auto_release_at || !hasOrderLinkSecret()) return;
  await deliver(o.id, "buyer", phone, TEMPLATES.shipped,
    [o.profiles?.display_name ?? "The seller", o.tracking_number || "not provided", o.delivery_code, lagosDate(o.auto_release_at)],
    orderLinkButtons(o.id));
});

export const notifyArrivalCheck = safely("arrival check", async (orderId) => {
  const o = await loadOrder(orderId);
  const phone = o && buyerPhone(o);
  if (!o || !phone || o.status !== "shipped" || !o.auto_release_at) return;
  await deliver(o.id, "buyer", phone, TEMPLATES.arrivalCheck,
    [firstName(o.buyer_name), o.profiles?.display_name ?? "the seller", `on ${lagosDate(o.auto_release_at)}`],
    [
      { kind: "reply", index: 0, payload: `arrived:${o.id}` },
      { kind: "reply", index: 1, payload: `notyet:${o.id}` },
      { kind: "reply", index: 2, payload: `problem:${o.id}` },
    ]);
});

export const notifyOrderComplete = safely("order complete", async (orderId) => {
  const o = await loadOrder(orderId);
  const phone = o && buyerPhone(o);
  // After a dispute the buyer gets the "dispute decided" message instead.
  if (!o || !phone || o.status !== "released" || o.dispute_outcome) return;
  await deliver(o.id, "buyer", phone, TEMPLATES.complete,
    [formatNaira(o.subtotal_kobo + o.delivery_kobo), o.profiles?.display_name ?? "the seller"],
    [
      { kind: "reply", index: 0, payload: `rate5:${o.id}` },
      { kind: "reply", index: 1, payload: `rate3:${o.id}` },
      { kind: "reply", index: 2, payload: `rate1:${o.id}` },
    ]);
});

// ---------------------------------------------------------------- seller messages

export const notifyPayoutSent = safely("payout sent", async (orderId) => {
  const admin = createAdminClient();
  const o = await loadOrder(orderId);
  if (!o || !o.profiles) return;
  const phone = await sellerPhone(o.seller_id);
  if (!phone) return;
  const [{ data: payout }, { data: account }] = await Promise.all([
    admin.from("payouts").select("amount_kobo, status").eq("order_id", orderId).maybeSingle<{ amount_kobo: number; status: string }>(),
    admin.from("payout_accounts").select("bank_name, account_last4").eq("seller_id", o.seller_id).maybeSingle<{ bank_name: string; account_last4: string }>(),
  ]);
  if (!payout || payout.status !== "paid") return;
  await deliver(o.id, "seller", phone, TEMPLATES.payoutSent, [
    formatNaira(payout.amount_kobo),
    account ? `${account.bank_name} ••••${account.account_last4}` : "your bank account",
    shortRef(o.id),
    String(trustScore(o.profiles)),
    o.profiles.completed_orders.toLocaleString("en-NG"),
    formatWindow(autoReleaseHours(o.profiles)),
  ]);
});

export const notifyDisputeOpened = safely("dispute opened", async (orderId) => {
  const o = await loadOrder(orderId);
  if (!o || o.status !== "disputed") return;
  const phone = await sellerPhone(o.seller_id);
  if (!phone) return;
  await deliver(o.id, "seller", phone, TEMPLATES.dispute,
    [buyerShort(o.buyer_name), shortRef(o.id), (o.dispute_reason ?? "a problem").toLowerCase(), o.dispute_details ?? "-", formatNaira(o.subtotal_kobo + o.delivery_kobo)],
    [{ kind: "reply", index: 1, payload: `replace:${o.id}` }]);
});

// ---------------------------------------------------------------- both

/** Tells the buyer and the seller what Kola decided about a dispute, and why. */
export const notifyDisputeDecided = safely("dispute decided", async (orderId) => {
  const o = await loadOrder(orderId);
  if (!o || !o.dispute_outcome || (o.status !== "refunded" && o.status !== "released")) return;
  const decision =
    o.dispute_outcome === "refund"
      ? `full refund of ${formatNaira(o.total_kobo)} to the buyer`
      : `${formatNaira(o.subtotal_kobo + o.delivery_kobo)} released to the seller`;
  const note = o.dispute_note || "-";

  const phone = buyerPhone(o);
  if (phone) await deliver(o.id, "buyer", phone, TEMPLATES.disputeDecided, [firstName(o.buyer_name), shortRef(o.id), decision, note]);

  const sPhone = await sellerPhone(o.seller_id);
  if (sPhone) {
    await deliver(o.id, "seller", sPhone, TEMPLATES.disputeDecided, [o.profiles?.display_name ?? "there", shortRef(o.id), decision, note]);
  }
});

// ---------------------------------------------------------------- daily job

/**
 * Run by the daily job:
 *  - "Did it arrive?" for shipped orders that release within the next 36 hours
 *  - "Order complete" for orders the job itself auto-released
 *  - retry messages that failed (up to 3 tries)
 */
export async function runNotificationJob() {
  if (!isWhatsAppConfigured()) return { skipped: true };
  const admin = createAdminClient();
  const soon = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const recently = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: dueSoon } = await admin.from("orders").select("id").eq("status", "shipped").lte("auto_release_at", soon).limit(200);
  for (const o of dueSoon ?? []) await notifyArrivalCheck(o.id);

  const { data: released } = await admin.from("orders").select("id").eq("status", "released").gte("released_at", recently).limit(200);
  for (const o of released ?? []) await notifyOrderComplete(o.id);

  const { data: failed } = await admin.from("notifications").select("id, payload").eq("status", "failed").lt("attempts", 3).limit(100);
  for (const n of (failed ?? []) as { id: string; payload: unknown }[]) await attempt(n.id, n.payload);

  return { arrivalChecks: dueSoon?.length ?? 0, completeChecked: released?.length ?? 0, retried: failed?.length ?? 0 };
}
