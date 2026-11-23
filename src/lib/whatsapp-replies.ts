import { buyerOrderPath, hasOrderLinkSecret } from "./order-links";
import { afterRelease } from "./release";
import { createAdminClient } from "./supabase/admin";
import { SITE_URL } from "./supabase/config";
import { lagosDate, normalizePhone, parseReplyPayload, sendText } from "./whatsapp";

const EXTENSION_HOURS = 48;

type ReplyOrder = {
  id: string;
  seller_id: string;
  status: string;
  buyer_name: string;
  buyer_phone: string | null;
  auto_release_at: string | null;
  release_extended: boolean;
  buyer_rating: number | null;
  profiles: { display_name: string } | null;
};

/**
 * Handles a tap on a reply button. Only acts if the tap came from the phone number
 * on the order (buyer actions) or the seller's saved number (seller actions).
 */
export async function handleReply(from: string, rawPayload: string) {
  const parsed = parseReplyPayload(rawPayload);
  if (!parsed) return;
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, seller_id, status, buyer_name, buyer_phone, auto_release_at, release_extended, buyer_rating, profiles(display_name)")
    .eq("id", parsed.orderId)
    .maybeSingle<ReplyOrder>();
  if (!order) return;
  const seller = order.profiles?.display_name ?? "the seller";
  const orderLink = hasOrderLinkSecret() ? `${SITE_URL}/order/${buyerOrderPath(order.id)}` : SITE_URL;

  if (parsed.action === "replace") {
    const { data: contact } = await admin
      .from("seller_contacts")
      .select("whatsapp_phone")
      .eq("seller_id", order.seller_id)
      .maybeSingle<{ whatsapp_phone: string }>();
    if (contact?.whatsapp_phone !== from || order.status !== "disputed") return;
    await admin.from("orders").update({ seller_offered_replacement_at: new Date().toISOString() }).eq("id", order.id);
    await sendText(from, "Thanks. We've noted that you're offering a replacement. Kola will tell the buyer and help you agree on the next steps.");
    return;
  }

  // Buyer actions: the tap must come from the buyer's own number.
  if (!order.buyer_phone || normalizePhone(order.buyer_phone) !== from) return;

  switch (parsed.action) {
    case "arrived": {
      const { data: released } = await admin.rpc("release_order", { p_order_id: order.id });
      if (released) await afterRelease(order.id); // sends the "Order complete" message
      return;
    }
    case "notyet": {
      if (order.status !== "shipped" || !order.auto_release_at) return;
      if (order.release_extended) {
        await sendText(from, `We've already given this order extra time. If it still hasn't arrived, tap "Something's wrong" on your order page and Kola will step in: ${orderLink}?dispute=1`);
        return;
      }
      const newTime = new Date(new Date(order.auto_release_at).getTime() + EXTENSION_HOURS * 3600 * 1000).toISOString();
      // Conditional update: only extends once, even if the button is tapped twice.
      const { data: extended } = await admin
        .from("orders")
        .update({ auto_release_at: newTime, release_extended: true })
        .eq("id", order.id)
        .eq("status", "shipped")
        .eq("release_extended", false)
        .select("id");
      if (extended?.length) {
        await sendText(from, `No problem. We've held the payment for 2 more days, until ${lagosDate(newTime)}. Your money is still safe. If it doesn't come, tap "Something's wrong" on your order page: ${orderLink}`);
      }
      return;
    }
    case "problem": {
      await sendText(from, `Sorry about that. Tell us what went wrong here and your money stays frozen while Kola reviews it: ${orderLink}?dispute=1`);
      return;
    }
    case "rate5":
    case "rate3":
    case "rate1": {
      if (order.status !== "released" || order.buyer_rating) return;
      const rating = Number(parsed.action.slice(4));
      await admin.from("orders").update({ buyer_rating: rating }).eq("id", order.id).is("buyer_rating", null);
      await sendText(from, `Thank you, ${order.buyer_name.split(/\s+/)[0]}. Your rating for ${seller} has been saved. Selling too? Get your own Kola link at ${SITE_URL}`);
      return;
    }
  }
}
