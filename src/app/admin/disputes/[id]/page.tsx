import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, DemoBanner, Field, Logo, Pill, btn, inputCls } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/orders";
import { REFUND_LABEL, type Refund } from "@/lib/refunds";
import { DEMO_DISPUTES, DISPUTE_SELECT, ago, getStaffUserId, shortRef, type DisputeCase } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { trustLabel, trustScore } from "@/lib/trust";
import { decideDispute, retryRefundAction } from "../actions";

export const metadata: Metadata = { title: "Dispute", robots: { index: false } };
export const instant = false;

const ERRORS: Record<string, string> = {
  outcome: "Choose who gets the money.",
  note: "Write the reason in 10 to 500 characters. Both the buyer and the seller will see it.",
  confirm: "Tick the box to confirm. This decision moves real money and can't be undone.",
  already: "This dispute was already decided, maybe by someone else just now. The page shows the result.",
  failed: "Something went wrong and nothing was changed. Try again.",
};

const DONE: Record<string, string> = {
  refund: "Decided: the buyer is being refunded in full.",
  release: "Decided: the money is being sent to the seller.",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

async function load(id: string): Promise<{ o: DisputeCase; refund: Refund | null; demo: boolean }> {
  await connection(); // always render at request time ("opened 3 hours ago" uses the current time)
  if (!isSupabaseConfigured) {
    const o = DEMO_DISPUTES.find((d) => d.id === id);
    if (!o) notFound();
    return { o, refund: null, demo: true };
  }
  if (!(await getStaffUserId()) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createAdminClient();
  const [{ data: o }, { data: refund }] = await Promise.all([
    admin.from("orders").select(DISPUTE_SELECT).eq("id", id).maybeSingle<DisputeCase>(),
    admin.from("refunds").select("*").eq("order_id", id).maybeSingle<Refund>(),
  ]);
  // Only orders that have been disputed belong here.
  if (!o || !o.disputed_at) notFound();
  return { o, refund: refund ?? null, demo: false };
}

export default async function DisputePage({ params, searchParams }: PageProps<"/admin/disputes/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { o, refund, demo } = await load(id);
  const seller = o.profiles?.display_name ?? "Seller";
  const sellerAmount = o.subtotal_kobo + o.delivery_kobo;
  const error = typeof sp.error === "string" && Object.hasOwn(ERRORS, sp.error) ? ERRORS[sp.error] : null;
  const done = typeof sp.done === "string" && Object.hasOwn(DONE, sp.done) ? DONE[sp.done] : null;
  const score = o.profiles ? trustScore(o.profiles) : null;

  return (
    <>
      {demo && <DemoBanner />}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Logo />
          <Link href="/admin/disputes" className="text-sm font-semibold text-muted hover:text-ink">
            ← All disputes
          </Link>
        </header>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted">{shortRef(o.id)}</span>
            <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
          </div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {o.buyer_name} <span className="text-muted">vs</span> {seller}
          </h1>
          <p className="text-sm text-muted">
            Buyer paid <b className="font-mono text-ink tabular-nums">{formatNaira(o.total_kobo)}</b>
            {o.disputed_at && <> · dispute opened {ago(o.disputed_at)} ago</>}
          </p>
        </section>

        {done && <p role="status" className="rounded-xl bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{done}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Buyer says</h2>
            <b>{o.dispute_reason}</b>
            <p className="text-sm">&ldquo;{o.dispute_details}&rdquo;</p>
            {o.disputed_at && <p className="text-xs text-muted">{when(o.disputed_at)}</p>}
          </Card>
          <Card className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Seller says</h2>
            {o.seller_response ? (
              <>
                <p className="text-sm">&ldquo;{o.seller_response}&rdquo;</p>
                {o.seller_responded_at && <p className="text-xs text-muted">{when(o.seller_responded_at)}</p>}
              </>
            ) : (
              <p className="text-sm text-muted">No reply yet.{o.disputed_at && ` Waiting ${ago(o.disputed_at)}.`}</p>
            )}
            {o.seller_offered_replacement_at && (
              <div>
                <Pill tone="ok">Offered a replacement on WhatsApp</Pill>
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
          <Card className="flex flex-col gap-1.5 text-sm">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">The order</h2>
            {o.items.map((i) => (
              <Line key={i.product_id} label={`${i.qty} × ${i.name}`} value={formatNaira(i.price_kobo * i.qty)} />
            ))}
            <Line label="Delivery" value={formatNaira(o.delivery_kobo)} />
            <Line label="Buyer protection" value={formatNaira(o.fee_kobo)} />
            <div className="mt-1 border-t border-line pt-2 font-bold">
              <Line label="Buyer paid" value={formatNaira(o.total_kobo)} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Paid</dt>
              <dd>{o.paid_at ? when(o.paid_at) : "-"}</dd>
              <dt className="text-muted">Shipped</dt>
              <dd>{o.shipped_at ? when(o.shipped_at) : "Not marked as shipped"}</dd>
              <dt className="text-muted">Tracking</dt>
              <dd className="font-mono">{o.tracking_number || "-"}</dd>
              <dt className="text-muted">Deliver to</dt>
              <dd>{o.buyer_address || "-"}</dd>
              <dt className="text-muted">Buyer phone</dt>
              <dd className="font-mono">{o.buyer_phone || "-"}</dd>
            </dl>
          </Card>
          <Card className="flex flex-col gap-1.5 text-sm">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Seller&apos;s record</h2>
            {o.profiles && score !== null ? (
              <>
                <b>
                  {score} · {trustLabel(score)}
                </b>
                <Line label="Completed orders" value={o.profiles.completed_orders.toLocaleString("en-NG")} />
                <Line label="Disputes" value={String(o.profiles.disputes_total)} />
                <Line label="Disputes lost" value={String(o.profiles.disputes_lost)} />
                <Line label="ID verified" value={o.profiles.id_verified ? "Yes" : "No"} />
                <Link href={`/${o.profiles.handle}`} target="_blank" className="mt-1 text-xs font-semibold text-indigo">
                  View their Kola page
                </Link>
              </>
            ) : (
              <p className="text-muted">Seller profile not found.</p>
            )}
          </Card>
        </div>

        {o.status === "disputed" ? (
          <Card className="flex flex-col gap-4 border-indigo">
            <div>
              <h2 className="font-display text-xl font-bold">Decide</h2>
              <p className="text-sm text-muted">The money moves as soon as you confirm. Both sides see your reason on their order page or dashboard, and on WhatsApp if they turned alerts on.</p>
            </div>
            {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
            <form action={decideDispute} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={o.id} />
              <fieldset className="grid gap-2 sm:grid-cols-2" disabled={demo}>
                <legend className="sr-only">Who gets the money</legend>
                <Choice
                  value="refund"
                  title="Refund the buyer"
                  amount={formatNaira(o.total_kobo)}
                  detail="Everything they paid, including the protection fee. Counts as a lost dispute for the seller."
                />
                <Choice
                  value="release"
                  title="Pay the seller"
                  amount={formatNaira(sellerAmount)}
                  detail="Item price and delivery, sent to their bank. Counts as a completed order."
                />
              </fieldset>
              <Field label="Reason (the buyer and the seller will both see this)">
                <textarea
                  name="note"
                  required
                  minLength={10}
                  maxLength={500}
                  rows={3}
                  disabled={demo}
                  className={inputCls}
                  placeholder="The seller confirmed a different colour was sent and no replacement is available."
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" required disabled={demo} className="mt-0.5" />
                <span>I&apos;ve read both sides. I understand this moves money and can&apos;t be undone.</span>
              </label>
              <button className={`${btn.primary} sm:self-start`} disabled={demo}>
                Confirm decision
              </button>
              {demo && <p className="text-xs text-muted">Demo mode: deciding is turned off until Supabase is connected.</p>}
            </form>
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-bold">Decision</h2>
            <div className="flex flex-wrap items-center gap-2">
              {o.dispute_outcome === "refund" ? (
                <Pill tone="warn">Buyer refunded {formatNaira(o.total_kobo)}</Pill>
              ) : o.dispute_outcome === "release" ? (
                <Pill tone="ok">Seller paid {formatNaira(sellerAmount)}</Pill>
              ) : (
                <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
              )}
              {o.resolved_at && <span className="text-xs text-muted">{when(o.resolved_at)}</span>}
            </div>
            {o.dispute_note && <p className="text-sm">&ldquo;{o.dispute_note}&rdquo;</p>}
            {!o.dispute_outcome && (
              <p className="text-sm text-muted">This order left the dispute without a staff decision (for example, the buyer confirmed delivery).</p>
            )}
            {refund && (
              <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{REFUND_LABEL[refund.status]}</b>
                  <span className="font-mono tabular-nums">{formatNaira(refund.amount_kobo)}</span>
                </div>
                {refund.last_error && <p className={refund.status === "failed" || refund.status === "needs_attention" ? "text-bad" : "text-muted"}>{refund.last_error}</p>}
                {refund.status === "processed" && <p className="text-muted">The buyer may wait up to 10 working days for it to reach their account.</p>}
                <p className="font-mono text-xs text-muted">
                  Paystack reference: {refund.reference}
                  {refund.attempt > 1 && ` (attempt ${refund.attempt})`}
                </p>
                {refund.status === "failed" && (
                  <form action={retryRefundAction}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className={`${btn.ghost} !py-2`}>Try the refund again</button>
                  </form>
                )}
              </div>
            )}
          </Card>
        )}
      </main>
    </>
  );
}

function Choice({ value, title, amount, detail }: { value: string; title: string; amount: string; detail: string }) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-xl border border-line p-3 has-[:checked]:border-indigo has-[:checked]:bg-indigo-soft">
      <span className="flex items-center gap-2">
        <input type="radio" name="outcome" value={value} required />
        <b className="text-sm">{title}</b>
      </span>
      <span className="font-mono text-lg font-semibold tabular-nums">{amount}</span>
      <span className="text-xs text-muted">{detail}</span>
    </label>
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
