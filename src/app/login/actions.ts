"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, SITE_URL } from "@/lib/supabase/config";

export async function sendMagicLink(formData: FormData) {
  if (!isSupabaseConfigured) redirect("/login?error=setup");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/login?error=email");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${SITE_URL}/auth/callback` },
  });
  if (error) redirect("/login?error=send");
  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
