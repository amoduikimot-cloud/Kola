import { createHmac, timingSafeEqual } from "node:crypto";

// Paystack API docs: https://paystack.com/docs/api/transaction/
const API = "https://api.paystack.co";
const secret = () => process.env.PAYSTACK_SECRET_KEY ?? "";

export const isPaystackConfigured = () => /^sk_(test|live)_/.test(secret());
export const isPaystackTestMode = () => secret().startsWith("sk_test_");

type InitResult = { authorization_url: string; reference: string };

/** Starts a payment. Amount is in kobo. Returns the Paystack page to send the buyer to. */
export async function initializeTransaction(input: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<InitResult> {
  const res = await fetch(`${API}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status) throw new Error(json?.message ?? `Paystack error ${res.status}`);
  return json.data as InitResult;
}

export type VerifiedTransaction = { status: string; reference: string; amount: number; currency: string };

/** Asks Paystack directly whether a payment succeeded. Never trust the browser's word for it. */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction | null> {
  const res = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret()}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status) return null;
  return json.data as VerifiedTransaction;
}

// ---------- Transfers (seller payouts) — https://paystack.com/docs/transfers/ ----------

type ApiResult<T> = { ok: true; data: T } | { ok: false; httpStatus: number; message: string };

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.status) return { ok: false, httpStatus: res.status, message: json?.message ?? `Paystack error ${res.status}` };
    return { ok: true, data: json.data as T };
  } catch (e) {
    // Network failure: we don't know whether Paystack acted on it.
    return { ok: false, httpStatus: 0, message: e instanceof Error ? e.message : "network error" };
  }
}

export type Bank = { name: string; code: string };

export async function listBanks(): Promise<Bank[]> {
  const r = await call<{ name: string; code: string; active: boolean }[]>("/bank?country=nigeria&currency=NGN&perPage=200");
  return r.ok ? r.data.filter((b) => b.active).map(({ name, code }) => ({ name, code })) : [];
}

/** Looks up the official name on a bank account, so the seller can see it's correct. */
export async function resolveAccount(accountNumber: string, bankCode: string) {
  return call<{ account_name: string; account_number: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
}

export async function createTransferRecipient(input: { name: string; accountNumber: string; bankCode: string }) {
  return call<{ recipient_code: string }>("/transferrecipient", {
    method: "POST",
    body: { type: "nuban", name: input.name, account_number: input.accountNumber, bank_code: input.bankCode, currency: "NGN" },
  });
}

export type TransferData = { status: string; reference: string; transfer_code: string; amount: number };

export async function initiateTransfer(input: { amountKobo: number; recipientCode: string; reference: string; reason: string }) {
  return call<TransferData>("/transfer", {
    method: "POST",
    body: { source: "balance", amount: input.amountKobo, recipient: input.recipientCode, reference: input.reference, reason: input.reason },
  });
}

export async function verifyTransfer(reference: string) {
  return call<TransferData>(`/transfer/verify/${encodeURIComponent(reference)}`);
}

// ---------- Refunds (buyer wins a dispute) — https://paystack.com/docs/payments/refunds/ ----------

/** Paystack refund statuses: pending, processing, needs-attention, failed, processed. */
export type RefundData = { id: number; status: string; amount: number; reference?: string | null };

/**
 * Refunds a payment. `transaction` is the original payment reference; `reference` is ours for this
 * refund attempt. Paystack accepts a reference only once (409 if reused), so a retry can't refund twice.
 */
export async function createRefund(input: { transaction: string; amountKobo: number; reference: string; customerNote: string }) {
  return call<RefundData>("/refund", {
    method: "POST",
    body: {
      transaction: input.transaction,
      amount: input.amountKobo,
      currency: "NGN",
      reference: input.reference,
      customer_note: input.customerNote,
      merchant_note: "Kola dispute decided in the buyer's favour",
    },
  });
}

/** Finds a refund by our reference. ok with null data = Paystack has no refund with that reference. */
export async function findRefund(reference: string): Promise<ApiResult<RefundData | null>> {
  const r = await call<RefundData[]>(`/refund?reference=${encodeURIComponent(reference)}`);
  if (!r.ok) return r;
  const match = r.data.find((x) => !x.reference || x.reference.toLowerCase() === reference.toLowerCase());
  return { ok: true, data: match ?? null };
}

/** Checks that a webhook really came from Paystack (HMAC-SHA512 of the raw body with the secret key). */
export function isValidWebhookSignature(rawBody: string, signature: string | null, key = secret()): boolean {
  if (!signature || !key) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
