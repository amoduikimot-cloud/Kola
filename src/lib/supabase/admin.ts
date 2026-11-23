import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * Supabase client with the service-role key. It bypasses Row Level Security,
 * so use it ONLY in server code (server actions, route handlers), never in a
 * "use client" file, and only after checking who is allowed to do the action.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const isAdminConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
