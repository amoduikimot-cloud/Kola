"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { notifyDisputeDecided } from "@/lib/notify";
import { processPayoutForOrder } from "@/lib/payouts";
import { processRefundForOrder, retryRefund } from "@/lib/refunds";
import { getStaffUserId } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

const isOrderId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Staff decide a dispute: refund the buyer in full, or release the money to the seller. */
export async function decideDispute(formData: FormData) {
  const staffId = await getStaffUserId();
  if (!staffId) notFound();

  const id = String(formData.get("id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim();
  if (!isOrderId(id)) notFound();
  const page = `/admin/disputes/${id}`;

  // Only fixed keys go in the URL; the page maps them to messages.
  if (outcome !== "refund" && outcome !== "release") redirect(`${page}?error=outcome`);
  if (note.length < 10 || note.length > 500) redirect(`${page}?error=note`);
  if (formData.get("confirm") !== "yes") redirect(`${page}?error=confirm`);

  const { data: decided, error } = await createAdminClient().rpc("resolve_dispute", {
    p_order_id: id,
    p_outcome: outcome,
    p_note: note,
    p_staff: staffId,
  });
  if (error) redirect(`${page}?error=failed`);
  if (!decided) redirect(`${page}?error=already`);

  // Move the money now; the daily job retries anything that doesn't go through.
  try {
    if (outcome === "refund") await processRefundForOrder(id);
    else await processPayoutForOrder(id);
  } catch (e) {
    console.error("[dispute] money step failed; the daily job will retry", id, e);
  }
  await notifyDisputeDecided(id);

  revalidatePath("/admin/disputes");
  redirect(`${page}?done=${outcome}`);
}

/** Starts a new refund attempt after Paystack reported a failure. */
export async function retryRefundAction(formData: FormData) {
  if (!(await getStaffUserId())) notFound();
  const id = String(formData.get("id") ?? "");
  if (!isOrderId(id)) notFound();
  await retryRefund(id);
  revalidatePath(`/admin/disputes/${id}`);
  redirect(`/admin/disputes/${id}`);
}
