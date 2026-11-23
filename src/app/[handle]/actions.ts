"use server";

import { redirect } from "next/navigation";
import { buyerFeeKobo } from "@/lib/money";
import { newBuyerToken, newDeliveryCode } from "@/lib/orders";
import { initializeTransaction, isPaystackConfigured } from "@/lib/paystack";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured, SITE_URL } from "@/lib/supabase/config";
import type { OrderItem, Product, Profile } from "@/lib/types";

type BuyerValues = { name: string; email: string; phone: string; address: string; whatsapp: boolean };
export type CheckoutState = { error: string | null; values?: BuyerValues };

const MAX_QTY = 20;

/** On an error, send back what the buyer typed so the form doesn't clear. */
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const values: BuyerValues = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    whatsapp: formData.get("whatsapp") === "on",
  };
  const result = await runCheckout(formData);
  return { ...result, values };
}

async function runCheckout(formData: FormData): Promise<CheckoutState> {
  if (!isSupabaseConfigured || !isAdminConfigured || !isPaystackConfigured()) {
    return { error: "Payments aren't set up yet. Add the Supabase service key and Paystack key (see README.md)." };
  }

  const handle = String(formData.get("handle") ?? "").toLowerCase();
  const buyer_name = String(formData.get("name") ?? "").trim();
  const buyer_email = String(formData.get("email") ?? "").trim().toLowerCase();
  const buyer_phone = String(formData.get("phone") ?? "").replace(/[^\d+]/g, "");
  const buyer_address = String(formData.get("address") ?? "").trim();

  if (buyer_name.length < 2) return { error: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) return { error: "Enter a valid email. Your receipt goes there." };
  if (!/^\+?\d{10,14}$/.test(buyer_phone)) return { error: "Enter a phone number, like 08031234567." };
  if (buyer_address.length < 8) return { error: "Enter a full delivery address." };

  // Quantities come from the browser; names and prices never do.
  let wanted: Record<string, number>;
  try {
    wanted = JSON.parse(String(formData.get("cart") ?? "{}"));
  } catch {
    return { error: "Your basket couldn't be read. Refresh the page and try again." };
  }
  const ids = Object.keys(wanted).filter((id) => Number.isInteger(wanted[id]) && wanted[id] > 0 && wanted[id] <= MAX_QTY);
  if (ids.length === 0) return { error: "Add at least one item." };

  const admin = createAdminClient();
  const { data: seller } = await admin
    .from("profiles")
    .select("id, handle, display_name, delivery_fee_kobo")
    .eq("handle", handle)
    .maybeSingle<Pick<Profile, "id" | "handle" | "display_name" | "delivery_fee_kobo">>();
  if (!seller) return { error: "This seller no longer exists." };

  const { data: products } = await admin
    .from("products")
    .select("id, name, price_kobo")
    .eq("seller_id", seller.id)
    .eq("active", true)
    .in("id", ids)
    .returns<Pick<Product, "id" | "name" | "price_kobo">[]>();
  if (!products || products.length !== ids.length) {
    return { error: "Some items are no longer available. Refresh the page and try again." };
  }

  const items: OrderItem[] = products.map((p) => ({ product_id: p.id, name: p.name, price_kobo: p.price_kobo, qty: wanted[p.id] }));
  const subtotal_kobo = items.reduce((sum, i) => sum + i.price_kobo * i.qty, 0);
  const delivery_kobo = seller.delivery_fee_kobo;
  const fee_kobo = buyerFeeKobo(subtotal_kobo);
  const total_kobo = subtotal_kobo + delivery_kobo + fee_kobo;

  const id = crypto.randomUUID();
  const reference = `KOLA-${id}`;
  const { token, hash } = newBuyerToken(id);
  const buyer_whatsapp_optin = formData.get("whatsapp") === "on";

  const { error: insertError } = await admin.from("orders").insert({
    id,
    seller_id: seller.id,
    buyer_name,
    buyer_email,
    buyer_phone,
    buyer_address,
    items,
    subtotal_kobo,
    delivery_kobo,
    fee_kobo,
    total_kobo,
    status: "pending_payment",
    payment_ref: reference,
    buyer_token_hash: hash,
    delivery_code: newDeliveryCode(),
    buyer_whatsapp_optin,
  });
  if (insertError) return { error: "We couldn't create your order. Try again." };

  let payUrl: string;
  try {
    const tx = await initializeTransaction({
      email: buyer_email,
      amountKobo: total_kobo,
      reference,
      callbackUrl: `${SITE_URL}/order/${id}/${token}`,
      metadata: { order_id: id, seller: seller.handle },
    });
    payUrl = tx.authorization_url;
  } catch {
    await admin.from("orders").delete().eq("id", id).eq("status", "pending_payment");
    return { error: "We couldn't reach the payment provider. Try again in a minute." };
  }
  redirect(payUrl);
}
