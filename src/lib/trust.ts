import type { Profile } from "./types";

/**
 * Starter trust score, 0–100. Deliberately simple so it is easy to explain to sellers:
 *  - up to 60 points for completed escrow orders (grows quickly at first, then slows)
 *  - 20 points for a verified ID
 *  - up to 20 points for a clean dispute record
 * Replace with a richer model once real order data exists.
 */
export function trustScore(p: TrustInput): number {
  const orders = Math.min(60, Math.round(60 * (1 - Math.exp(-p.completed_orders / 40))));
  const id = p.id_verified ? 20 : 0;
  const disputes =
    p.completed_orders === 0 ? 0 : Math.max(0, 20 - p.disputes_lost * 5 - Math.max(0, p.disputes_total - p.disputes_lost));
  return Math.max(0, Math.min(100, orders + id + disputes));
}

type TrustInput = Pick<Profile, "completed_orders" | "id_verified" | "disputes_total" | "disputes_lost">;

/**
 * Hours after "shipped" before money releases automatically, if the buyer
 * neither confirms, disputes, nor gives the delivery code. Trusted sellers wait less.
 */
export function autoReleaseHours(p: TrustInput): number {
  const score = trustScore(p);
  if (p.completed_orders < 10) return 120; // new seller: 5 days
  if (score >= 85 && p.disputes_lost === 0) return 48; // highly trusted: 2 days
  if (score >= 60) return 72; // trusted: 3 days
  return 120;
}

export function formatWindow(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
}

export function trustLabel(score: number): string {
  if (score >= 85) return "Highly trusted";
  if (score >= 60) return "Trusted";
  if (score >= 30) return "Building trust";
  return "New seller";
}
