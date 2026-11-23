import { NextResponse, type NextRequest } from "next/server";
import { runNotificationJob } from "@/lib/notify";
import { reconcilePayouts } from "@/lib/payouts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily job:
 *  1. Releases money for shipped orders whose buyer didn't confirm or dispute in time.
 *  2. Sends queued seller payouts and checks on any whose outcome is still unknown.
 *  3. WhatsApp: "Did your order arrive?" reminders, "Order complete" for auto-released
 *     orders, and retries of messages that failed.
 * Vercel Cron calls this on the schedule in vercel.json and sends
 * "Authorization: Bearer <CRON_SECRET>". Any other caller is refused.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: released, error } = await createAdminClient().rpc("auto_release_due_orders");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const payouts = await reconcilePayouts();
  const whatsapp = await runNotificationJob();
  return NextResponse.json({ released, payouts, whatsapp });
}
