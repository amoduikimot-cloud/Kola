import { createAdminClient, isAdminConfigured } from "./supabase/admin";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import type { Order, Profile } from "./types";

/**
 * Kola staff: signed-in users listed in the `staff` table (added by hand in SQL, see 0006_disputes.sql).
 * Returns the user id, or null for everyone else. Pages show "not found" to non-staff,
 * so the admin area doesn't reveal that it exists.
 */
export async function getStaffUserId(): Promise<string | null> {
  if (!isSupabaseConfigured || !isAdminConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await createAdminClient().from("staff").select("user_id").eq("user_id", user.id).maybeSingle<{ user_id: string }>();
  return data ? user.id : null;
}

/** What staff see for each dispute. */
export type DisputeCase = Order & {
  seller_offered_replacement_at: string | null;
  profiles: Pick<Profile, "handle" | "display_name" | "completed_orders" | "disputes_total" | "disputes_lost" | "id_verified"> | null;
};

export const DISPUTE_SELECT =
  "*, profiles(handle, display_name, completed_orders, disputes_total, disputes_lost, id_verified)";

/** Short reference shown to people, like KOLA-3F9A (same as in WhatsApp messages). */
export const shortRef = (id: string) => `KOLA-${id.slice(0, 4).toUpperCase()}`;

/** How long ago, in words: "3 hours", "2 days". */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

// ---------------------------------------------------------------- demo mode

const base = {
  seller_id: "demo",
  buyer_email: null,
  payment_ref: "KOLA-DEMO",
  paid_at: "2026-11-18T09:12:00Z",
  released_at: null,
  auto_release_at: null,
  tracking_number: "ABK-48213",
  dispute_outcome: null,
  dispute_note: null,
  resolved_at: null,
  seller_offered_replacement_at: null,
  profiles: { handle: "toluadire", display_name: "Tolu's Adire House", completed_orders: 1284, disputes_total: 3, disputes_lost: 0, id_verified: true },
} as const;

/** Sample disputes shown at /admin/disputes when Supabase isn't connected, so the screen can be previewed. */
export const DEMO_DISPUTES: DisputeCase[] = [
  {
    ...base,
    id: "7c21d0a4-1111-4222-8333-444455556666",
    buyer_name: "Chidi Okafor",
    buyer_phone: "08031234567",
    buyer_address: "4 Admiralty Way, Lekki Phase 1, Lagos",
    items: [{ product_id: "demo-2", name: "Aso-oke gele, ready to tie", price_kobo: 2_500_000, qty: 1 }],
    subtotal_kobo: 2_500_000,
    delivery_kobo: 350_000,
    fee_kobo: 37_500,
    total_kobo: 2_887_500,
    status: "disputed",
    shipped_at: "2026-11-19T15:00:00Z",
    dispute_reason: "Not what was shown",
    dispute_details: "The gele came in a different colour from the photo. I ordered wine and gold but got plain gold.",
    disputed_at: "2026-11-22T10:30:00Z",
    seller_response: "We ran out of wine and gold and sent the closest colour. I'm happy to send the right one when it's back in stock next week.",
    seller_responded_at: "2026-11-22T14:05:00Z",
    seller_offered_replacement_at: "2026-11-22T14:06:00Z",
    created_at: "2026-11-18T09:10:00Z",
  },
  {
    ...base,
    id: "3f9a2c1e-1111-4222-8333-444455556666",
    buyer_name: "Ngozi Adeyemi",
    buyer_phone: "08029876543",
    buyer_address: "12 Adeola Odeku St, Victoria Island, Lagos",
    items: [{ product_id: "demo-0", name: "Indigo adire two-piece", price_kobo: 3_800_000, qty: 1 }],
    subtotal_kobo: 3_800_000,
    delivery_kobo: 350_000,
    fee_kobo: 57_000,
    total_kobo: 4_207_000,
    status: "disputed",
    shipped_at: "2026-11-17T11:00:00Z",
    dispute_reason: "It never arrived",
    dispute_details: "The tracking number hasn't changed in 5 days and the rider isn't picking calls.",
    disputed_at: "2026-11-23T18:45:00Z",
    seller_response: null,
    seller_responded_at: null,
    created_at: "2026-11-16T20:00:00Z",
  },
];
