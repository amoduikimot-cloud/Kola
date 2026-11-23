"use client";

import { useState, useTransition } from "react";
import { Field, btn, inputCls } from "@/components/ui";
import type { Bank } from "@/lib/paystack";
import { savePayoutAccount, type PayoutAccountState } from "./actions";

type Current = { bank_name: string; account_last4: string; account_name: string } | null;

export function PayoutAccountForm({ banks, current }: { banks: Bank[]; current: Current }) {
  const [state, setState] = useState<PayoutAccountState>({ error: null });
  const [editing, setEditing] = useState(!current);
  const [pending, startTransition] = useTransition();

  if (!editing && current) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{current.account_name}</div>
          <div className="font-mono text-sm text-muted">
            {current.bank_name} ••••{current.account_last4}
          </div>
          {state.savedName && (
            <div className="mt-1 text-xs text-ok">Saved. Any waiting payouts are being sent. If that isn&apos;t your name, change it now.</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setState({ error: null });
            setEditing(true);
          }}
          className={`${btn.ghost} !py-2`}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await savePayoutAccount({ error: null }, fd);
          setState(result);
          if (!result.error) setEditing(false);
        });
      }}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <Field label="Bank">
        <select id="bank_code" name="bank_code" required defaultValue="" className={inputCls} disabled={banks.length === 0}>
          <option value="" disabled>
            {banks.length ? "Choose your bank" : "Bank list unavailable"}
          </option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account number">
        <input
          id="account_number"
          name="account_number"
          required
          inputMode="numeric"
          pattern="\d{10}"
          maxLength={10}
          placeholder="0123456789"
          className={`${inputCls} font-mono`}
        />
      </Field>
      <button className={btn.primary} disabled={pending || banks.length === 0}>
        {pending ? "Checking…" : "Save account"}
      </button>
      {state.error && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad sm:col-span-3">{state.error}</p>}
      <p className="text-xs text-muted sm:col-span-3">
        {banks.length === 0
          ? "Payouts need the Paystack key to be set up (see README.md)."
          : "We check the account name with your bank before saving. Payouts only go to this account."}
      </p>
      {current && (
        <button type="button" onClick={() => setEditing(false)} className="justify-self-start text-sm font-semibold text-muted sm:col-span-3">
          Cancel
        </button>
      )}
    </form>
  );
}
