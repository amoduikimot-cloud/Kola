import { NextResponse, type NextRequest } from "next/server";
import { markOrderPaid } from "@/lib/orders";
import { isValidWebhookSignature, verifyTransaction, verifyTransfer } from "@/lib/paystack";
import { syncPayoutFromPaystack } from "@/lib/payouts";

/**
 * Paystack calls this when a payment succeeds, or a seller payout succeeds or fails,
 * even if nobody has the page open.
 * Set it in Paystack: Settings -> API Keys & Webhooks -> Webhook URL = https://<your-site>/api/paystack/webhook
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!isValidWebhookSignature(raw, request.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const reference = event.data?.reference ?? "";

  // Buyer payment. Double-check with Paystack rather than trusting the webhook body alone.
  if (event.event === "charge.success" && reference.startsWith("KOLA-")) {
    const tx = await verifyTransaction(reference);
    if (tx?.status === "success") {
      const result = await markOrderPaid(tx.reference, tx.amount, tx.currency);
      if (!result.ok) console.error("[paystack webhook] could not mark paid", tx.reference, result.reason);
    }
  }

  // Seller payout.
  if (event.event?.startsWith("transfer.") && reference.startsWith("kola-po-")) {
    const t = await verifyTransfer(reference);
    if (t.ok) await syncPayoutFromPaystack(reference, t.data.status, t.data.transfer_code);
  }

  // Always answer 200 quickly so Paystack doesn't keep retrying events we've handled or don't need.
  return NextResponse.json({ received: true });
}
