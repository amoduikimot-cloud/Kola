"use client";

import { useActionState, useMemo, useState } from "react";
import { Field, btn, inputCls } from "@/components/ui";
import { buyerFeeKobo, formatNaira } from "@/lib/money";
import type { Product } from "@/lib/types";
import { startCheckout, type CheckoutState } from "./actions";

type Props = {
  handle: string;
  sellerName: string;
  products: Pick<Product, "id" | "name" | "description" | "price_kobo">[];
  deliveryKobo: number;
};

export function Cart({ handle, sellerName, products, deliveryKobo }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"shop" | "details">("shop");
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(startCheckout, { error: null });

  const subtotal = useMemo(
    () => products.reduce((sum, p) => sum + (cart[p.id] ?? 0) * p.price_kobo, 0),
    [cart, products],
  );
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const fee = buyerFeeKobo(subtotal);
  const total = subtotal + deliveryKobo + fee;

  const change = (id: string, d: number) =>
    setCart((c) => {
      const q = Math.max(0, Math.min(20, (c[id] ?? 0) + d));
      const next = { ...c, [id]: q };
      if (!q) delete next[id];
      return next;
    });

  if (step === "details") {
    const v = state.values;
    return (
      <form action={formAction} className="flex flex-col gap-4 px-4 pb-6">
        <button type="button" onClick={() => setStep("shop")} className="self-start text-sm font-semibold text-indigo">
          ← Back to items
        </button>
        <h2 className="font-display text-xl font-bold">Pay {sellerName} safely</h2>

        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface-2 p-3 text-center text-xs text-muted">
          <div><b className="block text-ink">1. You pay</b>Kola holds it</div>
          <div><b className="block text-ink">2. Seller ships</b>with tracking</div>
          <div><b className="block text-ink">3. You confirm</b>seller gets paid</div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-2xl border border-line p-3 text-sm">
          {products.filter((p) => cart[p.id]).map((p) => (
            <Row key={p.id} label={`${cart[p.id]} × ${p.name}`} value={formatNaira(p.price_kobo * cart[p.id])} />
          ))}
          <Row label="Delivery" value={formatNaira(deliveryKobo)} />
          <Row label="Buyer protection (1.5%, max ₦2,000)" value={formatNaira(fee)} />
          <div className="mt-1 border-t border-line pt-2">
            <Row label="Total" value={formatNaira(total)} bold />
          </div>
        </div>

        <input type="hidden" name="handle" value={handle} />
        <input type="hidden" name="cart" value={JSON.stringify(cart)} />
        <Field label="Full name">
          <input name="name" required autoComplete="name" defaultValue={v?.name} className={inputCls} placeholder="Ngozi Okafor" />
        </Field>
        <Field label="Email" hint="Your receipt and order link go here.">
          <input name="email" type="email" required autoComplete="email" defaultValue={v?.email} className={inputCls} placeholder="ngozi@example.com" />
        </Field>
        <Field label="Phone number">
          <input name="phone" type="tel" required autoComplete="tel" defaultValue={v?.phone} className={inputCls} placeholder="08031234567" />
        </Field>
        <Field label="Delivery address">
          <textarea name="address" required rows={2} autoComplete="street-address" defaultValue={v?.address} className={inputCls} placeholder="12 Adeola Odeku St, Victoria Island, Lagos" />
        </Field>
        <label htmlFor="whatsapp-optin" className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
          <input id="whatsapp-optin" name="whatsapp" type="checkbox" defaultChecked={v?.whatsapp} className="mt-0.5 h-4 w-4 accent-[var(--indigo)]" />
          <span>
            <b>Send my order updates and delivery code on WhatsApp</b>
            <span className="block text-xs text-muted">To the phone number above. Reply STOP anytime to stop.</span>
          </span>
        </label>

        {state.error && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
        <button className={`${btn.primary} w-full`} disabled={pending}>
          {pending ? "Opening secure payment…" : `Pay ${formatNaira(total)} into escrow`}
        </button>
        <p className="text-center text-xs text-muted">
          You&apos;ll pay on Paystack. {sellerName} gets the money only after you confirm the order arrived.
        </p>
      </form>
    );
  }

  return (
    <>
      <section className="flex flex-col px-4 pb-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">Products</h2>
        {products.length === 0 && <p className="py-6 text-center text-sm text-muted">No products yet.</p>}
        {products.map((p) => {
          const q = cart[p.id] ?? 0;
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0">
                <div className="font-semibold">{p.name}</div>
                {p.description && <div className="text-xs text-muted">{p.description}</div>}
                <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{formatNaira(p.price_kobo)}</div>
              </div>
              {q ? (
                <div className="flex shrink-0 items-center gap-2">
                  <QtyBtn label={`Remove one ${p.name}`} onClick={() => change(p.id, -1)}>−</QtyBtn>
                  <span className="w-4 text-center font-mono">{q}</span>
                  <QtyBtn label={`Add one ${p.name}`} onClick={() => change(p.id, 1)}>+</QtyBtn>
                </div>
              ) : (
                <button type="button" onClick={() => change(p.id, 1)} className={`${btn.ghost} !px-3 !py-1.5`}>
                  Add
                </button>
              )}
            </div>
          );
        })}
      </section>
      <div className="sticky bottom-0 border-t border-line bg-surface p-4">
        <button type="button" className={`${btn.primary} w-full`} disabled={!count} onClick={() => setStep("details")}>
          {count ? `Pay safely · ${formatNaira(subtotal)}` : "Add an item to continue"}
        </button>
        <p className="mt-2 text-center text-xs text-muted">Your money is held by Kola until you confirm delivery.</p>
      </div>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function QtyBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-lg border border-line font-bold">
      {children}
    </button>
  );
}
