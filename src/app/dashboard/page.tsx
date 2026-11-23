import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Field, Logo, Pill, btn, inputCls } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { TrustRing } from "@/components/trust-ring";
import { getCurrentSeller } from "@/lib/data";
import { formatNaira } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/supabase/config";
import { autoReleaseHours, formatWindow, trustLabel, trustScore } from "@/lib/trust";
import { DELIVERY_CODE_RESULT, STATUS_LABEL, STATUS_TONE } from "@/lib/orders";
import { PAYOUT_LABEL, type Payout } from "@/lib/payouts";
import { getBanks } from "@/lib/banks";
import { PayoutAccountForm } from "./payout-account-form";
import { ORDER_COLUMNS, type Order, type Product } from "@/lib/types";
import { signOut } from "../login/actions";
import { addProduct, deleteProduct, enterDeliveryCode, markShipped, updateDeliveryFee, updateWhatsApp } from "./actions";

export const metadata: Metadata = { title: "Dashboard" };
export const instant = false;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { user, profile } = await getCurrentSeller();
  if (!user) redirect("/login");
  if (!profile) redirect("/onboarding");

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Product[]>();

  const { data: orders } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", user.id)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Order[]>();
  const [{ data: payouts }, { data: payoutAccount }, banks] = await Promise.all([
    supabase
      .from("payouts")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Payout[]>(),
    supabase
      .from("payout_accounts")
      .select("bank_name, account_last4, account_name")
      .eq("seller_id", user.id)
      .maybeSingle<{ bank_name: string; account_last4: string; account_name: string }>(),
    getBanks(),
  ]);
  const { data: contact } = await supabase
    .from("seller_contacts")
    .select("whatsapp_phone")
    .eq("seller_id", user.id)
    .maybeSingle<{ whatsapp_phone: string }>();
  const payoutByOrder = new Map((payouts ?? []).map((p) => [p.order_id, p]));
  const paidOutKobo = (payouts ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount_kobo, 0);
  const owedKobo = (payouts ?? []).filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount_kobo, 0);
  const payoutProblem = (payouts ?? []).find((p) => p.status === "failed" || (p.status === "pending" && p.last_error))?.last_error;

  const heldKobo = (orders ?? [])
    .filter((o) => o.status === "held" || o.status === "shipped" || o.status === "disputed")
    .reduce((sum, o) => sum + o.subtotal_kobo + o.delivery_kobo, 0);

  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const link = `${SITE_URL}/${profile.handle}`;
  const score = trustScore(profile);
  const releaseHours = autoReleaseHours(profile);
  const codeResult = typeof sp.code === "string" && Object.hasOwn(DELIVERY_CODE_RESULT, sp.code) ? sp.code : null;
  const notice = codeResult ? DELIVERY_CODE_RESULT[codeResult] : null;
  const noticeOk = codeResult === "released";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <Logo />
        <form action={signOut}>
          <button className="text-sm font-semibold text-muted hover:text-ink">Sign out</button>
        </form>
      </header>

      <section className="flex flex-col gap-1">
        <p className="text-sm text-muted">Welcome back</p>
        <h1 className="font-display text-3xl font-bold">{profile.display_name}</h1>
      </section>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${noticeOk ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          {notice}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Card className="flex min-w-0 flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Your Kola link</h2>
          <div className="truncate font-mono text-lg">{link.replace(/^https?:\/\//, "")}</div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={link} />
            <Link href={`/${profile.handle}`} className={`${btn.ghost} !py-2`} target="_blank">
              View my page
            </Link>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <TrustRing score={score} />
          <div>
            <div className="font-semibold">{trustLabel(score)}</div>
            <div className="text-xs text-muted">{profile.completed_orders} completed orders</div>
            <div className="text-xs text-muted">
              Auto-release: <b className="text-ink">{formatWindow(releaseHours)}</b> after shipping
            </div>
            <div className="mt-1">
              {profile.id_verified ? <Pill tone="ok">ID verified</Pill> : <Pill tone="warn">Verify ID: coming soon</Pill>}
            </div>
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Payouts</h2>
          <div className="flex gap-4 text-sm text-muted">
            <span>
              Paid to you: <b className="font-mono text-ink tabular-nums">{formatNaira(paidOutKobo)}</b>
            </span>
            <span>
              On the way: <b className="font-mono text-ink tabular-nums">{formatNaira(owedKobo)}</b>
            </span>
          </div>
        </div>
        {!payoutAccount && owedKobo > 0 && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            You have {formatNaira(owedKobo)} waiting. Add your bank account to receive it.
          </p>
        )}
        {payoutAccount && payoutProblem && (
          <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{payoutProblem}</p>
        )}
        <PayoutAccountForm banks={banks} current={payoutAccount ?? null} />
        <p className="text-xs text-muted">
          When a buyer confirms delivery, the item price and delivery fee are sent to this account. Kola keeps the buyer-protection fee.
        </p>
      </Card>

      <Card className="flex flex-col">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Orders</h2>
          <span className="text-sm text-muted">
            In escrow for you: <b className="font-mono text-ink tabular-nums">{formatNaira(heldKobo)}</b>
          </span>
        </div>
        {(orders ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No paid orders yet. Share your link to get your first one.</p>
        )}
        {(orders ?? []).map((o) => (
          <div key={o.id} className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{o.buyer_name}</div>
                <div className="text-xs text-muted">
                  {o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")} ·{" "}
                  {new Date(o.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums">{formatNaira(o.subtotal_kobo + o.delivery_kobo)}</span>
                {payoutByOrder.has(o.id) ? (
                  <Pill tone={payoutByOrder.get(o.id)!.status === "paid" ? "ok" : payoutByOrder.get(o.id)!.status === "failed" ? "kola" : "indigo"}>
                    {PAYOUT_LABEL[payoutByOrder.get(o.id)!.status]}
                  </Pill>
                ) : (
                  <Pill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Pill>
                )}
              </div>
            </div>
            {o.status === "held" && (
              <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm">
                <div className="text-xs text-muted">
                  Send to: {o.buyer_address} · {o.buyer_phone}
                </div>
                <form action={markShipped} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  <input name="tracking" maxLength={80} placeholder="Tracking number (optional)" className={`${inputCls} min-w-0 flex-1 !py-2`} />
                  <button className={`${btn.primary} !py-2`}>Mark as shipped</button>
                </form>
              </div>
            )}
            {o.status === "shipped" && o.auto_release_at && (
              <p className="text-xs text-muted">
                Waiting for the buyer to confirm. Releases automatically on{" "}
                {new Date(o.auto_release_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.
              </p>
            )}
            {(o.status === "held" || o.status === "shipped") && (
              <form action={enterDeliveryCode} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="id" value={o.id} />
                <label htmlFor={`code-${o.id}`} className="text-xs font-semibold text-muted">
                  Delivered? Enter the buyer&apos;s code to get paid now:
                </label>
                <input
                  id={`code-${o.id}`}
                  name="code"
                  required
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="0000"
                  autoComplete="off"
                  className={`${inputCls} !w-24 !py-2 text-center font-mono tracking-[0.3em]`}
                />
                <button className={`${btn.ghost} !py-2`}>Release payment</button>
              </form>
            )}
            {o.status === "disputed" && (
              <p className="text-xs text-kola">
                Buyer reported: {o.dispute_reason}. &ldquo;{o.dispute_details}&rdquo; Kola will contact you.
              </p>
            )}
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-bold">WhatsApp alerts</h2>
        <p className="text-sm text-muted">Get a WhatsApp message when an order is paid, when a buyer reports a problem, and when your payout is sent.</p>
        <form action={updateWhatsApp} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Your WhatsApp number" hint="Leave empty and save to stop alerts.">
              <input
                id="seller-whatsapp"
                name="whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                defaultValue={contact?.whatsapp_phone ? `+${contact.whatsapp_phone}` : ""}
                placeholder="08031234567"
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>
          <button className={`${btn.ghost} mb-5`}>Save</button>
        </form>
        {contact && <Pill tone="ok">Alerts on</Pill>}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-bold">Delivery fee</h2>
        <form action={updateDeliveryFee} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Flat fee added to every order (₦)" hint="Use 0 for free delivery.">
              <input name="delivery_fee" required inputMode="decimal" defaultValue={profile.delivery_fee_kobo / 100} className={`${inputCls} font-mono`} />
            </Field>
          </div>
          <button className={`${btn.ghost} mb-5`}>Save</button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-bold">Add a product</h2>
        {error && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <form action={addProduct} className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Product name">
            <input name="name" required minLength={2} maxLength={80} placeholder="Indigo adire two-piece" className={inputCls} />
          </Field>
          <Field label="Price (₦)">
            <input name="price" required inputMode="decimal" placeholder="38000" className={`${inputCls} font-mono`} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Short description (optional)">
              <input name="description" maxLength={200} placeholder="Sizes 8–18, hand-dyed" className={inputCls} />
            </Field>
          </div>
          <button className={`${btn.primary} sm:col-span-2 sm:justify-self-start`}>Add product</button>
        </form>
      </Card>

      <Card className="flex flex-col">
        <h2 className="mb-2 font-display text-xl font-bold">Your products</h2>
        {(products ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No products yet. Add your first one above and it will appear on your link.</p>
        )}
        {(products ?? []).map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.name}</div>
              {p.description && <div className="truncate text-xs text-muted">{p.description}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono text-sm font-semibold tabular-nums">{formatNaira(p.price_kobo)}</span>
              <form action={deleteProduct}>
                <input type="hidden" name="id" value={p.id} />
                <button className={`${btn.danger} !px-3 !py-1.5 !text-xs`}>Remove</button>
              </form>
            </div>
          </div>
        ))}
      </Card>
    </main>
  );
}
