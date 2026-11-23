import { cacheLife } from "next/cache";
import { isPaystackConfigured, listBanks, type Bank } from "./paystack";

/** Nigerian banks from Paystack. The list rarely changes, so it's cached for a day. */
export async function getBanks(): Promise<Bank[]> {
  "use cache";
  cacheLife("days");
  if (!isPaystackConfigured()) return [];
  return listBanks();
}
