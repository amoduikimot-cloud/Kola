import { notifyPayoutSent } from "./notify";
import { initiateTransfer, verifyTransfer } from "./paystack";
import { createAdminClient } from "./supabase/admin";

/**
 * Seller payout engine.
 *
 * Safety rules:
 *  - One payout row per order (unique in the database), one Paystack reference per attempt.
 *    Paystack refuses a second transfer with the same reference, so retries can't double-pay.
 *  - A payout is "claimed" (pending -> processing) before calling Paystack, so two
 *    requests running at once can't both send it.
 *  - If we can't tell what happened (network error), it stays "processing" and is
 *    checked with Paystack later. We only start a new attempt after Paystack says it failed.
 */

export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

export type Payout = {
  id: string;
  order_id: string;
  seller_id: string;
  amount_kobo: number;
  status: PayoutStatus;
  attempt: number;
  reference: string;
  transfer_code: string | null;
  last_error: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  pending: "Payout queued",
  processing: "Payout sending",
  paid: "Paid to your bank",
  failed: "Payout failed",
};

const FAILED = new Set(["failed", "reversed", "abandoned", "blocked", "rejected"]);
export const referenceFor = (orderId: string, attempt: number) => `kola-po-${orderId}-${attempt}`;

/** Applies what Paystack says about a transfer to our payout row. */
export async function syncPayoutFromPaystack(reference: string, paystackStatus: string, transferCode?: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  if (paystackStatus === "success") {
    const { data: paid } = await admin
      .from("payouts")
      .update({ status: "paid", paid_at: now, updated_at: now, last_error: null, ...(transferCode ? { transfer_code: transferCode } : {}) })
      .eq("reference", reference)
      .neq("status", "paid")
      .select("order_id");
    // Tell the seller on WhatsApp, once, when the money has actually landed.
    if (paid?.[0]) await notifyPayoutSent(paid[0].order_id);
  } else if (FAILED.has(paystackStatus)) {
    await admin
      .from("payouts")
      .update({ status: "failed", updated_at: now, last_error: `Bank transfer ${paystackStatus}. Check your bank details.` })
      .eq("reference", reference)
      .eq("status", "processing");
  } else if (paystackStatus === "otp") {
    await admin
      .from("payouts")
      .update({ updated_at: now, last_error: "Paystack is asking for an OTP. Turn off OTP for transfers in Paystack settings." })
      .eq("reference", reference);
  }
}

/** Tries to send one payout. Safe to call any number of times. */
export async function processPayout(payoutId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: payout } = await admin.from("payouts").select("*").eq("id", payoutId).maybeSingle<Payout>();
  if (!payout || payout.status !== "pending") return;

  const { data: account } = await admin
    .from("payout_accounts")
    .select("recipient_code")
    .eq("seller_id", payout.seller_id)
    .maybeSingle<{ recipient_code: string }>();
  if (!account) {
    await admin.from("payouts").update({ last_error: "Add your bank account to receive this payout." }).eq("id", payout.id);
    return;
  }

  // Claim it. If another request already did, stop.
  const { data: claimed } = await admin
    .from("payouts")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", payout.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return;

  const res = await initiateTransfer({
    amountKobo: payout.amount_kobo,
    recipientCode: account.recipient_code,
    reference: payout.reference,
    reason: `Kola order ${payout.order_id.slice(0, 8)}`,
  });

  if (res.ok) {
    await admin.from("payouts").update({ transfer_code: res.data.transfer_code, last_error: null }).eq("id", payout.id);
    await syncPayoutFromPaystack(payout.reference, res.data.status, res.data.transfer_code);
    return;
  }
  if (res.httpStatus === 0 || res.httpStatus >= 500) {
    // Unknown outcome: leave as "processing"; reconcilePayouts() checks it with Paystack later.
    await admin.from("payouts").update({ last_error: "Waiting for confirmation from Paystack." }).eq("id", payout.id);
    return;
  }
  // Paystack refused the request. If a transfer with this reference exists anyway, sync it;
  // otherwise nothing was sent, so put it back in the queue with the reason.
  const existing = await verifyTransfer(payout.reference);
  if (existing.ok) {
    await syncPayoutFromPaystack(payout.reference, existing.data.status, existing.data.transfer_code);
    return;
  }
  await admin
    .from("payouts")
    .update({ status: "pending", last_error: res.message, updated_at: new Date().toISOString() })
    .eq("id", payout.id)
    .eq("status", "processing");
}

export async function processPayoutForOrder(orderId: string) {
  const { data } = await createAdminClient().from("payouts").select("id").eq("order_id", orderId).maybeSingle<{ id: string }>();
  if (data) await processPayout(data.id);
}

/**
 * Daily job: send queued payouts and check on ones whose outcome we don't know yet.
 * Pass a sellerId to only handle that seller (used right after they save bank details).
 */
export async function reconcilePayouts(sellerId?: string) {
  const admin = createAdminClient();
  let pendingQ = admin.from("payouts").select("id").eq("status", "pending").limit(100);
  if (sellerId) pendingQ = pendingQ.eq("seller_id", sellerId);
  const { data: pending } = await pendingQ;
  for (const p of pending ?? []) await processPayout(p.id);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let stuckQ = admin.from("payouts").select("reference").eq("status", "processing").lt("updated_at", tenMinutesAgo).limit(100);
  if (sellerId) stuckQ = stuckQ.eq("seller_id", sellerId);
  const { data: stuck } = await stuckQ;
  for (const p of stuck ?? []) {
    const v = await verifyTransfer(p.reference);
    if (v.ok) {
      await syncPayoutFromPaystack(p.reference, v.data.status, v.data.transfer_code);
    } else if (v.httpStatus === 404 || v.httpStatus === 400) {
      // Paystack has no transfer with this reference, so nothing was sent: queue it again.
      await admin.from("payouts").update({ status: "pending", updated_at: new Date().toISOString() }).eq("reference", p.reference).eq("status", "processing");
    }
  }
  return { sent: pending?.length ?? 0, checked: stuck?.length ?? 0 };
}

/** After a seller fixes their bank details, give failed payouts a fresh attempt (new reference). */
export async function retryFailedPayouts(sellerId: string) {
  const admin = createAdminClient();
  const { data: failed } = await admin.from("payouts").select("id, order_id, attempt").eq("seller_id", sellerId).eq("status", "failed");
  for (const p of (failed ?? []) as Pick<Payout, "id" | "order_id" | "attempt">[]) {
    const attempt = p.attempt + 1;
    await admin
      .from("payouts")
      .update({ status: "pending", attempt, reference: referenceFor(p.order_id, attempt), last_error: null, updated_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("status", "failed");
  }
}
