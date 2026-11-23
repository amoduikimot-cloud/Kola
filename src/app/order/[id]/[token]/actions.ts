"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DISPUTE_REASONS, tokenMatches } from "@/lib/orders";
import { notifyDisputeOpened } from "@/lib/notify";
import { afterRelease } from "@/lib/release";
import { createAdminClient } from "@/lib/supabase/admin";

/** Every buyer action re-checks the secret token from the order link. */
async function authorize(id: string, token: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("orders").select("buyer_token_hash").eq("id", id).maybeSingle<{ buyer_token_hash: string | null }>();
  if (!data || !tokenMatches(token, data.buyer_token_hash)) redirect("/");
  return admin;
}

export async function confirmReceived(formData: FormData) {
  const id = String(formData.get("id"));
  const token = String(formData.get("token"));
  const admin = await authorize(id, token);
  const { data: released } = await admin.rpc("release_order", { p_order_id: id });
  if (released) await afterRelease(id);
  revalidatePath(`/order/${id}/${token}`);
}

export async function raiseDispute(formData: FormData) {
  const id = String(formData.get("id"));
  const token = String(formData.get("token"));
  const reason = String(formData.get("reason") ?? "");
  const details = String(formData.get("details") ?? "").trim().slice(0, 1000);
  const page = `/order/${id}/${token}`;
  if (!(DISPUTE_REASONS as readonly string[]).includes(reason)) redirect(`${page}?dispute=1&error=reason`);
  if (details.length < 10) redirect(`${page}?dispute=1&error=details`);
  const admin = await authorize(id, token);
  const { data: opened } = await admin.rpc("open_dispute", { p_order_id: id, p_reason: reason, p_details: details });
  if (opened) await notifyDisputeOpened(id);
  redirect(page);
}
