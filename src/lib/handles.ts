/** Words that can't be used as a handle because they are (or will be) app pages. */
export const RESERVED_HANDLES = new Set([
  "login", "logout", "signup", "auth", "dashboard", "onboarding", "settings", "api", "admin",
  "pay", "checkout", "order", "orders", "deals", "help", "support", "terms", "privacy", "about", "kola",
]);

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}

export function handleError(handle: string): string | null {
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) return "Use 3–30 letters, numbers or underscores.";
  if (RESERVED_HANDLES.has(handle)) return "That name is reserved. Try another.";
  return null;
}
