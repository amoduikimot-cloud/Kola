import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import type { Product, Profile } from "./types";

/** Sample seller shown at /toluadire when Supabase is not set up yet. */
const DEMO_PROFILE: Profile = {
  id: "demo",
  handle: "toluadire",
  display_name: "Tolu's Adire House",
  bio: "Hand-dyed adire from Itoko market, Abeokuta. Ships across Nigeria and abroad.",
  location: "Abeokuta, Ogun",
  id_verified: true,
  completed_orders: 1284,
  disputes_total: 3,
  disputes_lost: 0,
  delivery_fee_kobo: 350_000,
  created_at: "2025-03-01T00:00:00Z",
};

const DEMO_PRODUCTS: Product[] = [
  { name: "Indigo adire two-piece", description: "Sizes 8–18", price_kobo: 3_800_000 },
  { name: "Ankara bucket hat", description: "Reversible, one size", price_kobo: 1_250_000 },
  { name: "Aso-oke gele, ready to tie", description: "Pre-pleated, wine and gold", price_kobo: 2_500_000 },
].map((p, i) => ({ ...p, id: `demo-${i}`, seller_id: "demo", active: true, created_at: DEMO_PROFILE.created_at }));

export async function getSellerByHandle(
  handle: string,
): Promise<{ profile: Profile; products: Product[]; demo: boolean } | null> {
  const h = handle.toLowerCase();
  if (!isSupabaseConfigured) {
    return h === DEMO_PROFILE.handle ? { profile: DEMO_PROFILE, products: DEMO_PRODUCTS, demo: true } : null;
  }
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("handle", h).maybeSingle<Profile>();
  if (!profile) return null;
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("seller_id", profile.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .returns<Product[]>();
  return { profile, products: products ?? [], demo: false };
}

/** The signed-in user and their profile (profile is null until onboarding is done). */
export async function getCurrentSeller() {
  if (!isSupabaseConfigured) return { user: null, profile: null };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  return { user, profile };
}
