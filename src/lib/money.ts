// All money in Kola is stored as whole kobo (₦1 = 100 kobo) to avoid rounding errors.

export function formatNaira(kobo: number): string {
  const naira = kobo / 100;
  return (
    "₦" +
    naira.toLocaleString("en-NG", {
      minimumFractionDigits: Number.isInteger(naira) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Parses what a seller types ("12,500" or "12500.50") into kobo. Returns null if invalid. */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const kobo = Math.round(parseFloat(cleaned) * 100);
  return kobo > 0 ? kobo : null;
}

/** Buyer protection fee: 1.5% of the subtotal, capped at ₦2,000. */
export function buyerFeeKobo(subtotalKobo: number): number {
  return Math.min(Math.round(subtotalKobo * 0.015), 200_000);
}
