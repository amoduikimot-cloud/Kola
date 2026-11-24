import { createRefund, findRefund } from "./paystack";
import { createAdminClient } from "./supabase/admin";

/**
 * Buyer refunds, for disputes decided in the buyer's favour.
 *
 * Safety rules (same idea as payouts):
 *  - One refund row per order (unique in the database), one Paystack reference per attempt.
 *    Paystack refuses a reference it has seen before, so a retried request can't refund twice.
 *  - A refund is claimed (queued -> sending) before Paystack is called, so two requests can't both send it.
 *  - If we don't know what happened (network error), we look the reference up later instead of guessing.
 *  - A new attempt (new reference) only starts when a person presses "Try again" after Paystack said it failed.
 */

export type RefundStatus = "queued" | "sending" | "needs_attention" | "processed" | "failed";

export type Refund = {
  id: string;
  order_id: string;
  amount_kobo: number;
  status: RefundStatus;
  attempt: number;
  reference: string;
  paystack_refund_id: string | null;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const REFUND_LABEL: Record<RefundStatus, string> = {
  queued: "Refund queued",
  sending: "Refund in progress",
  needs_attention: "Refund needs bank details",
  processed: "Refunded",
  failed: "Refund failed",
};

export const refundReferenceFor = (orderId: string, attempt: number) => `kola-rf-${orderId}-${attempt}`;

/** Maps Paystack's refund status to ours. Unknown statuses are treated as still in progress. */
export function refundStatusFromPaystack(status: string): RefundStatus {
  if (status === "processed") return "processed";
  if (status === "failed") return "failed";
  if (status === "needs-attention") return "needs_attention";
  return "sending"; // pending, processing
}

const ERRORS: Partial<Record<RefundStatus, string>> = {
  needs_attention:
    "Paystack needs the buyer's bank account to finish this refund. Get it from the buyer, then complete the refund in the Paystack dashboard (Refunds).",
  failed: "Paystack couldn't process this refund, so the money is back in Kola's balance. Press Try again.",
};

/** Applies Paystack's current view of a refund to our row. */
async function applyStatus(refund: Pick<Refund, "id" | "reference">, paystack: { id: number; status: string }) {
  const status = refundStatusFromPaystack(paystack.status);
  const now = new Date().toISOString();
  await createAdminClient()
    .from("refunds")
    .update({
      status,
      paystack_refund_id: String(paystack.id),
      last_error: ERRORS[status] ?? null,
      updated_at: now,
      ...(status === "processed" ? { processed_at: now } : {}),
    })
    .eq("id", refund.id)
    .eq("reference", refund.reference) // ignore news about an older attempt
    .neq("status", "processed");
}

/** Asks Paystack about one refund and updates our row. */
export async function syncRefund(refund: Pick<Refund, "id" | "reference" | "status">) {
  const found = await findRefund(refund.reference);
  if (!found.ok) return;
  if (found.data) {
    await applyStatus(refund, found.data);
  } else if (refund.status === "sending") {
    // Paystack has no refund with this reference, so our request never arrived: queue it again.
    await createAdminClient()
      .from("refunds")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", refund.id)
      .eq("reference", refund.reference)
      .eq("status", "sending");
  }
}

/** Sends one queued refund to Paystack. Safe to call any number of times. */
export async function processRefund(refundId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: refund } = await admin.from("refunds").select("*").eq("id", refundId).maybeSingle<Refund>();
  if (!refund || refund.status !== "queued") return;
  const { data: order } = await admin.from("orders").select("payment_ref").eq("id", refund.order_id).maybeSingle<{ payment_ref: string | null }>();
  if (!order?.payment_ref) {
    await admin.from("refunds").update({ last_error: "This order has no payment reference, so it can't be refunded automatically." }).eq("id", refund.id);
    return;
  }

  // Claim it. If another request already did, stop.
  const { data: claimed } = await admin
    .from("refunds")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", refund.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return;

  const res = await createRefund({
    transaction: order.payment_ref,
    amountKobo: refund.amount_kobo,
    reference: refund.reference,
    customerNote: "Refund from Kola after reviewing your order",
  });
  if (res.ok) {
    await applyStatus(refund, res.data);
    return;
  }
  if (res.httpStatus === 409) {
    // Paystack already has this reference: look at that refund rather than creating another.
    await syncRefund({ ...refund, status: "sending" });
    return;
  }
  if (res.httpStatus === 0 || res.httpStatus >= 500) {
    // Unknown outcome: stay "sending"; reconcileRefunds() looks the reference up later.
    await admin.from("refunds").update({ last_error: "Waiting for confirmation from Paystack." }).eq("id", refund.id);
    return;
  }
  // Paystack refused the request outright, so nothing was refunded. Show why; staff can try again.
  await admin
    .from("refunds")
    .update({ status: "failed", last_error: `Paystack refused the refund: ${res.message}`, updated_at: new Date().toISOString() })
    .eq("id", refund.id)
    .eq("status", "sending");
}

export async function processRefundForOrder(orderId: string) {
  const { data } = await createAdminClient().from("refunds").select("id").eq("order_id", orderId).maybeSingle<{ id: string }>();
  if (data) await processRefund(data.id);
}

/** Staff pressed "Try again" on a failed refund: start a new attempt with a new reference. */
export async function retryRefund(orderId: string) {
  const admin = createAdminClient();
  const { data: r } = await admin.from("refunds").select("id, attempt").eq("order_id", orderId).eq("status", "failed").maybeSingle<Pick<Refund, "id" | "attempt">>();
  if (!r) return;
  const attempt = r.attempt + 1;
  const { data: requeued } = await admin
    .from("refunds")
    .update({ status: "queued", attempt, reference: refundReferenceFor(orderId, attempt), last_error: null, updated_at: new Date().toISOString() })
    .eq("id", r.id)
    .eq("status", "failed")
    .select("id");
  if (requeued?.length) await processRefund(r.id);
}

/** Paystack webhook (refund.*): find our refund for that payment and check it with Paystack. */
export async function syncRefundForPayment(paymentRef: string) {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("payment_ref", paymentRef).maybeSingle<{ id: string }>();
  if (!order) return;
  const { data: refund } = await admin.from("refunds").select("id, reference, status").eq("order_id", order.id).maybeSingle<Pick<Refund, "id" | "reference" | "status">>();
  if (refund && refund.status !== "processed") await syncRefund(refund);
}

/** Daily job: send queued refunds and check on ones still in progress. */
export async function reconcileRefunds() {
  const admin = createAdminClient();
  const { data: queued } = await admin.from("refunds").select("id").eq("status", "queued").limit(100);
  for (const r of queued ?? []) await processRefund(r.id);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: open } = await admin
    .from("refunds")
    .select("id, reference, status")
    .in("status", ["sending", "needs_attention"])
    .lt("updated_at", tenMinutesAgo)
    .limit(100);
  for (const r of (open ?? []) as Pick<Refund, "id" | "reference" | "status">[]) await syncRefund(r);
  return { sent: queued?.length ?? 0, checked: open?.length ?? 0 };
}
