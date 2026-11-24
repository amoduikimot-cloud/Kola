import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, DemoBanner, Logo, Pill } from "@/components/ui";
import { formatNaira } from "@/lib/money";
import { REFUND_LABEL, type Refund } from "@/lib/refunds";
import { DEMO_DISPUTES, DISPUTE_SELECT, ago, getStaffUserId, shortRef, type DisputeCase } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Disputes", robots: { index: false } };
export const instant = false;

type RefundRow = Pick<Refund, "order_id" | "status" | "amount_kobo" | "last_error">;

async function load(): Promise<{ open: DisputeCase[]; decided: DisputeCase[]; refunds: RefundRow[]; demo: boolean }> {
  await connection(); // always render at request time ("opened 3 hours ago" uses the current time)
  if (!isSupabaseConfigured) return { open: DEMO_DISPUTES, decided: [], refunds: [], demo: true };
  if (!(await getStaffUserId())) notFound();
  const admin = createAdminClient();
  const [{ data: open }, { data: decided }, { data: refunds }] = await Promise.all([
    admin.from("orders").select(DISPUTE_SELECT).eq("status", "disputed").order("disputed_at", { ascending: true }).limit(200).returns<DisputeCase[]>(),
    admin
      .from("orders")
      .select(DISPUTE_SELECT)
      .not("dispute_outcome", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(20)
      .returns<DisputeCase[]>(),
    admin.from("refunds").select("order_id, status, amount_kobo, last_error").neq("status", "processed").limit(100).returns<RefundRow[]>(),
  ]);
  return { open: open ?? [], decided: decided ?? [], refunds: refunds ?? [], demo: false };
}

export default async function DisputesPage() {
  const { open, decided, refunds, demo } = await load();
  const frozen = open.reduce((s, o) => s + o.total_kobo, 0);
  const stuck = refunds.filter((r) => r.status === "failed" || r.status === "needs_attention");

  return (
    <>
      {demo && <DemoBanner />}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Logo />
          <Pill tone="indigo">Kola staff</Pill>
        </header>

        <section className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-bold">Disputes</h1>
          <p className="text-sm text-muted">
            {open.length === 0 ? "Nothing waiting. " : `${open.length} waiting for a decision, oldest first. `}
            {open.length > 0 && (
              <>
                Money frozen: <b className="font-mono text-ink tabular-nums">{formatNaira(frozen)}</b>
              </>
            )}
          </p>
        </section>

        {stuck.length > 0 && (
          <Card className="flex flex-col gap-2 border-bad">
            <h2 className="font-display text-lg font-bold">Refunds that need you</h2>
            {stuck.map((r) => (
              <Link key={r.order_id} href={`/admin/disputes/${r.order_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
                <span className="font-semibold">
                  {shortRef(r.order_id)} · {REFUND_LABEL[r.status]}
                </span>
                <span className="font-mono tabular-nums">{formatNaira(r.amount_kobo)}</span>
              </Link>
            ))}
          </Card>
        )}

        <Card className="flex flex-col">
          <h2 className="mb-1 font-display text-xl font-bold">Waiting for a decision</h2>
          {open.length === 0 && <p className="py-6 text-center text-sm text-muted">No open disputes.</p>}
          {open.map((o) => (
            <CaseRow key={o.id} o={o} />
          ))}
        </Card>

        {decided.length > 0 && (
          <Card className="flex flex-col">
            <h2 className="mb-1 font-display text-xl font-bold">Recently decided</h2>
            {decided.map((o) => (
              <CaseRow key={o.id} o={o} />
            ))}
          </Card>
        )}
      </main>
    </>
  );
}

function CaseRow({ o }: { o: DisputeCase }) {
  const seller = o.profiles?.display_name ?? "Seller";
  return (
    <Link
      href={`/admin/disputes/${o.id}`}
      className="-mx-2 flex flex-col gap-1.5 rounded-xl border-b border-line px-2 py-3 last:border-0 hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {o.buyer_name} <span className="text-muted">vs</span> {seller}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums">{formatNaira(o.total_kobo)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono">{shortRef(o.id)}</span>
        <span>·</span>
        <span>{o.dispute_reason}</span>
        {o.status === "disputed" && o.disputed_at && (
          <>
            <span>·</span>
            <span>opened {ago(o.disputed_at)} ago</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {o.dispute_outcome === "refund" && <Pill tone="warn">Refunded buyer</Pill>}
        {o.dispute_outcome === "release" && <Pill tone="ok">Paid seller</Pill>}
        {o.status === "disputed" && (o.seller_response ? <Pill tone="indigo">Seller replied</Pill> : <Pill tone="kola">No seller reply yet</Pill>)}
        {o.status === "disputed" && o.seller_offered_replacement_at && <Pill tone="ok">Replacement offered</Pill>}
      </div>
    </Link>
  );
}
