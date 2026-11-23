import { notifyOrderComplete } from "./notify";
import { processPayoutForOrder } from "./payouts";

/**
 * Everything that should happen right after an order is released, wherever the release
 * came from (buyer's button, delivery code, WhatsApp reply). Failures are retried by the daily job.
 */
export async function afterRelease(orderId: string) {
  try {
    await processPayoutForOrder(orderId);
  } catch (e) {
    console.error("[payout] immediate payout failed; will retry", orderId, e);
  }
  await notifyOrderComplete(orderId);
}
