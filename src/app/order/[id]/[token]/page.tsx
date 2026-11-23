import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Field, Logo, Pill, btn, inputCls } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { formatNaira } from "@/lib/money";
import { DISPUTE_REASONS, STATUS_LABEL, STATUS_TONE, markOrderPaid, tokenMatches } from "@/lib/orders";
import { isPaystackConfigured, verifyTransaction } from "@/lib/paystack";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/supabase/config";
import { ORDER_COLUMNS, type Order, type OrderStatus } from "@/lib/types";
import { confirmReceived, raiseDispute } from "./actions";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };
export const instant = false;

type Row = Order & { buyer_token_hash: string | null; delivery_code: string | null; profiles: { handle: string; display_name: string } | null };

async function loadOrder(id: string, token: string): Promise<Row | null> {
  if (!isAdminConfigured || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select(`${ORDER_COLUMNS}, buyer_token_hash, delivery_code, profiles(handle, display_name)`)
    .eq("id", id)
    .maybeSingle<Row>();
  if (!data || !tokenMatches(token, data.buyer_token_hash)) return null;
  return data;
}

export default async function OrderPage({ params, searchParams }: PageProps<"/order/[id]/[token]">) {
  const { id, token } = await params;
  const sp = await searchParams;
  let order = await loadOrder(id, token);
  if (!order) notFound();

  // Coming back from Paystack: confirm the payment with Paystack directly.
  if (order.status === "pending_payment" && order.payment_ref && isPaystackConfigured()) {
    const tx = await verifyTransaction(order.payment_ref);
    if (tx?.status === "success") {
      await markOrderPaid(tx.reference, tx.amount, tx.currency);
      order = (await loadOrder(id, token)) ?? order;
    }
  }

  const seller = order.profiles?.display_name ?? "The seller";
  const link = `${SITE_URL}/order/${id}/${token}`;
  const showDispute = sp.dispute === "1" && (order.status === "held" || order.status === "shipped");
  const disputeError =
    sp.error === "reason" ? "Choose what went wrong." : sp.error === "details" ? "Describe the problem in a sentence or two." : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Pill tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Pill>
      </header>

      <div className="flex flex-col gap-1 rounded-2xl bg-indigo p-5 text-on-indigo">
        <span className="text-xs opacity-80">{vaultCaption(order.status, seller)}</span>
        <span className="font-display text-3xl font-extrabold tabular-nums">{formatNaira(order.total_kobo)}</span>
        <p className="text-sm opacity-90">{vaultText(order, seller)}</p>
      </div>

      {order.delivery_code && (order.status === "held" || order.status === "shipped") && (
        <Card className="flex flex-col gap-2 border-indigo">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">Your delivery code</span>
          <span className="font-mono text-4xl font-semibold tracking-[0.3em] tabular-nums">{order.delivery_code}</span>
          <p className="text-sm text-muted">
            Give this code to the rider or {seller} <b className="text-ink">only when you&apos;re holding the item and it&apos;s right</b>.
            The code releases your payment to them immediately.
          </p>
        </Card>
      )}

      <Card>
        <Timeline status={order.status} seller={seller} />
      </Card>

      {order.status === "shipped" && (
        <Card className="text-sm">
          <b>{order.tracking_number ? `Tracking: ${order.tracking_number}` : "Shipped"}</b>
          {order.auto_release_at && (
            <p className="text-muted">
              If you don&apos;t confirm or report a problem, payment releases on{" "}
              {new Date(order.auto_release_at).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })}.
            </p>
          )}
        </Card>
      )}

      {(order.status === "held" || order.status === "shipped") && !showDispute && (
        <div className="flex flex-col gap-2">
          <form action={confirmReceived}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="token" value={token} />
            <button className={`${btn.primary} w-full`}>I&apos;ve received it. Release payment</button>
          </form>
          <Link href={`/order/${id}/${token}?dispute=1`} className={`${btn.danger} w-full`}>
            Something&apos;s wrong
          </Link>
          <p className="text-center text-xs text-muted">Only confirm once you have the item and it&apos;s what you ordered.</p>
        </div>
      )}

      {showDispute && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Tell us what went wrong</h2>
          <p className="text-sm text-muted">The money stays frozen and {seller} can&apos;t receive it while Kola reviews.</p>
          {disputeError && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{disputeError}</p>}
          <form action={raiseDispute} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="token" value={token} />
            <fieldset className="flex flex-col gap-2">
              {DISPUTE_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                  <input type="radio" name="reason" value={r} required /> {r}
                </label>
              ))}
            </fieldset>
            <Field label="What happened?">
              <textarea name="details" required minLength={10} rows={3} className={inputCls} placeholder="The gele came in a different colour from the photo." />
            </Field>
            <button className={btn.primary}>Open dispute</button>
            <Link href={`/order/${id}/${token}`} className="text-center text-sm font-semibold text-muted">
              Cancel
            </Link>
          </form>
        </Card>
      )}

      {order.status === "disputed" && (
        <Card className="text-sm">
          <b>Dispute: {order.dispute_reason}</b>
          <p className="text-muted">{order.dispute_details}</p>
          <p className="mt-2 text-muted">Kola will contact you and {seller} by email or phone. Most disputes are settled within 48 hours.</p>
        </Card>
      )}

      <Card className="flex flex-col gap-1.5 text-sm">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Order from {seller}</h2>
        {order.items.map((i) => (
          <Line key={i.product_id} label={`${i.qty} × ${i.name}`} value={formatNaira(i.price_kobo * i.qty)} />
        ))}
        <Line label="Delivery" value={formatNaira(order.delivery_kobo)} />
        <Line label="Buyer protection" value={formatNaira(order.fee_kobo)} />
        <div className="mt-1 border-t border-line pt-2 font-bold">
          <Line label="Total" value={formatNaira(order.total_kobo)} />
        </div>
        <p className="mt-2 text-xs text-muted">Deliver to: {order.buyer_address}</p>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <b>Keep this page</b>
        <p className="text-muted">This private link is how you track the order and release payment. Don&apos;t share it.</p>
        <CopyButton text={link} label="Copy order link" />
      </Card>
    </main>
  );
}

function vaultCaption(status: OrderStatus, seller: string) {
  if (status === "pending_payment") return "Waiting for your payment";
  if (status === "released") return `Paid to ${seller}`;
  if (status === "disputed") return "Frozen while Kola reviews";
  if (status === "refunded") return "Refunded to you";
  return "Held safely by Kola";
}

function vaultText(o: Order, seller: string) {
  if (o.status === "pending_payment") return "We haven't received your payment yet. If you just paid, refresh this page in a minute.";
  if (o.status === "released") return `Thanks for confirming. ${seller}'s trust score just went up.`;
  if (o.status === "disputed") return `${seller} can't withdraw this money until the dispute is settled.`;
  if (o.status === "refunded") return "The money has been sent back to your account.";
  return `${seller} gets paid only after you confirm the order arrived as described.`;
}

function Timeline({ status, seller }: { status: OrderStatus; seller: string }) {
  const steps = [
    ["Paid", "Your payment is confirmed"],
    ["Held by Kola", `${seller} can see it but can't withdraw it`],
    ["Shipped", `${seller} sends it, with tracking if available`],
    ["You confirm", "Give the delivery code, or tap “I’ve received it”"],
    [`Paid to ${seller}`, "Money released, trust score updated"],
  ];
  const reached: Record<OrderStatus, number> = {
    pending_payment: 0, held: 2, shipped: 3, delivered: 4, disputed: 2, released: 5, refunded: 2,
  };
  const n = reached[status];
  return (
    <ol className="flex flex-col">
      {steps.map(([title, sub], i) => {
        const done = i < n;
        const now = i === n;
        return (
          <li key={title} className="relative grid grid-cols-[22px_1fr] gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && (
              <span className={`absolute left-[10px] top-[22px] bottom-0 w-0.5 ${done ? "bg-ok" : "bg-line"}`} aria-hidden="true" />
            )}
            <span
              className={`z-10 grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-[11px] font-bold ${
                done ? "border-ok bg-ok text-surface" : now ? "border-indigo bg-surface" : "border-line bg-surface"
              }`}
            >
              {done ? "✓" : ""}
            </span>
            <div>
              <b className="text-sm">{title}</b>
              <span className="block text-xs text-muted">{sub}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
