"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { handleError, normalizeHandle } from "@/lib/handles";

export async function createProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const display_name = String(formData.get("display_name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;

  const back = (error: string) =>
    redirect(
      `/onboarding?error=${encodeURIComponent(error)}&handle=${encodeURIComponent(handle)}&name=${encodeURIComponent(display_name)}`,
    );

  const hErr = handleError(handle);
  if (hErr) back(hErr);
  if (display_name.length < 2 || display_name.length > 60) back("Enter a shop or creator name of 2–60 characters.");
  if (bio && bio.length > 280) back("Keep your bio under 280 characters.");

  const { error } = await supabase.from("profiles").insert({ id: user.id, handle, display_name, location, bio });
  if (error) {
    if (error.code === "23505") back(`kola.link/${handle} is taken. Try another name.`);
    back("We couldn't save your profile. Try again.");
  }
  redirect("/dashboard");
}
