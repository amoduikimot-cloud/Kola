"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseNairaToKobo } from "@/lib/money";
import { DELIVERY_CODE_RESULT } from "@/lib/orders";
import { autoReleaseHours } from "@/lib/trust";
import type { Profile } from "@/lib/types";
import { getBanks } from "@/lib/banks";
import { createTransferRecipient, isPaystackConfigured, resolveAccount } from "@/lib/paystack";
import { reconcilePayouts, retryFailedPayouts } from "@/lib/payouts";
import { notifyShipped } from "@/lib/notify";
import { afterRelease } from "@/lib/release";
import { normalizePhone } from "@/lib/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function addProduct(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price_kobo = parseNairaToKobo(String(formData.get("price") ?? ""));

  if (name.length < 2 || name.length > 80) redirect("/dashboard?error=" + encodeURIComponent("Product name must be 2–80 characters."));
  if (!price_kobo) redirect("/dashboard?error=" + encodeURIComponent("Enter a price in naira, like 12500."));

  const { error } = await supabase.from("products").insert({ seller_id: user.id, name, description, price_kobo });
  if (error) redirect("/dashboard?error=" + encodeURIComponent("We couldn't add that product. Try again."));
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function updateDeliveryFee(formData: FormData) {
  const { supabase, user } = await requireUser();
  const raw = String(formData.get("delivery_fee") ?? "").trim();
  const kobo = raw === "0" ? 0 : parseNairaToKobo(raw);
  if (kobo === null) redirect("/dashboard?error=" + encodeURIComponent("Enter a delivery fee in naira, like 3500, or 0 for free delivery."));
  await supabase.from("profiles").update({ delivery_fee_kobo: kobo }).eq("id", user.id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function markShipped(formData: FormData) {
  const { user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const tracking = String(formData.get("tracking") ?? "").trim().slice(0, 80) || null;
  const admin = createAdminClient();
  // The waiting time depends on the seller's trust record, read from the database (not the form).
  const { data: profile } = await admin
    .from("profiles")
    .select("completed_orders, id_verified, disputes_total, disputes_lost")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "completed_orders" | "id_verified" | "disputes_total" | "disputes_lost">>();
  if (!profile) redirect("/onboarding");
  const now = new Date();
  const autoRelease = new Date(now.getTime() + autoReleaseHours(profile) * 60 * 60 * 1000);
  // Orders have no update policy for sellers, so this uses the server-only admin client,
  // limited to this seller's own order that is currently "held".
  const { data: shipped } = await admin
    .from("orders")
    .update({ status: "shipped", shipped_at: now.toISOString(), auto_release_at: autoRelease.toISOString(), tracking_number: tracking })
    .eq("id", id)
    .eq("seller_id", user.id)
    .eq("status", "held")
    .select("id");
  if (shipped?.length) await notifyShipped(id);
  revalidatePath("/dashboard");
}

/** Saves the number Kola sends order alerts to. Entering it is the seller's opt-in. */
export async function updateWhatsApp(formData: FormData) {
  const { supabase, user } = await requireUser();
  const raw = String(formData.get("whatsapp") ?? "").trim();
  if (!raw) {
    await supabase.from("seller_contacts").delete().eq("seller_id", user.id);
    revalidatePath("/dashboard");
    redirect("/dashboard");
  }
  const phone = normalizePhone(raw);
  if (!phone) redirect("/dashboard?error=" + encodeURIComponent("Enter a WhatsApp number like 08031234567, or +233… for other countries."));
  await supabase.from("seller_contacts").upsert({ seller_id: user.id, whatsapp_phone: phone, opted_in_at: new Date().toISOString() });
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Seller enters the buyer's 4-digit code at handover; a correct code releases the money immediately. */
export async function enterDeliveryCode(formData: FormData) {
  const { user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 4) redirect("/dashboard?code=format");

  const { data: result } = await createAdminClient().rpc("release_with_code", {
    p_order_id: id,
    p_seller_id: user.id,
    p_code: code,
  });
  if (result === "released") await afterRelease(id);
  revalidatePath("/dashboard");
  // Only a known result key goes in the URL; the dashboard maps it to a fixed message.
  redirect("/dashboard?code=" + (String(result) in DELIVERY_CODE_RESULT ? String(result) : "error"));
}

/** The seller's side of a dispute, read by Kola staff before they decide. Can be sent once. */
export async function respondToDispute(formData: FormData) {
  const { user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const response = String(formData.get("response") ?? "").trim().slice(0, 1000);
  if (response.length < 10) redirect("/dashboard?error=" + encodeURIComponent("Write your side of the dispute in a sentence or two."));
  // Orders have no update policy for sellers, so this uses the admin client, limited to this
  // seller's own order that is still disputed and has no reply yet.
  await createAdminClient()
    .from("orders")
    .update({ seller_response: response, seller_responded_at: new Date().toISOString() })
    .eq("id", id)
    .eq("seller_id", user.id)
    .eq("status", "disputed")
    .is("seller_response", null);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export type PayoutAccountState = { error: string | null; savedName?: string };

/** Checks the account name with Paystack, registers it for transfers, then sends any waiting payouts. */
export async function savePayoutAccount(_prev: PayoutAccountState, formData: FormData): Promise<PayoutAccountState> {
  const { user } = await requireUser();
  if (!isPaystackConfigured()) return { error: "Payouts aren't set up yet. Add the Paystack key (see README.md)." };

  const bankCode = String(formData.get("bank_code") ?? "");
  const accountNumber = String(formData.get("account_number") ?? "").replace(/\D/g, "");
  if (!bankCode) return { error: "Choose your bank." };
  if (accountNumber.length !== 10) return { error: "Enter your 10-digit NUBAN account number." };

  const banks = await getBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return { error: "Choose your bank from the list." };

  const resolved = await resolveAccount(accountNumber, bankCode);
  if (!resolved.ok) return { error: "We couldn't find that account. Check the number and bank." };

  const recipient = await createTransferRecipient({ name: resolved.data.account_name, accountNumber, bankCode });
  if (!recipient.ok) return { error: "Paystack couldn't register this account for payouts. Try again later." };

  const admin = createAdminClient();
  const { error } = await admin.from("payout_accounts").upsert({
    seller_id: user.id,
    bank_code: bankCode,
    bank_name: bank.name,
    account_last4: accountNumber.slice(-4),
    account_name: resolved.data.account_name,
    recipient_code: recipient.data.recipient_code,
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: "We couldn't save your bank details. Try again." };

  await retryFailedPayouts(user.id);
  await reconcilePayouts(user.id);
  revalidatePath("/dashboard");
  return { error: null, savedName: resolved.data.account_name };
}

export async function deleteProduct(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  // Row Level Security also blocks deleting other sellers' products; the seller_id filter is a second guard.
  await supabase.from("products").delete().eq("id", id).eq("seller_id", user.id);
  revalidatePath("/dashboard");
}
