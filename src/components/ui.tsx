import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Logo() {
  return (
    <Link href="/" className="font-display text-xl font-extrabold tracking-tight text-ink">
      kola<span className="text-kola">.</span>
    </Link>
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
export const btn = {
  primary: `${btnBase} bg-indigo text-on-indigo hover:brightness-110`,
  ghost: `${btnBase} border border-line bg-surface text-ink hover:bg-surface-2`,
  danger: `${btnBase} border border-line bg-surface text-bad hover:bg-bad-soft`,
};

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-indigo focus:outline-none";

export function Pill({ tone = "indigo", children }: { tone?: "ok" | "indigo" | "kola" | "warn"; children: ReactNode }) {
  const tones = {
    ok: "bg-ok-soft text-ok",
    indigo: "bg-indigo-soft text-indigo",
    kola: "bg-kola-soft text-kola",
    warn: "bg-warn-soft text-warn",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function DemoBanner() {
  return (
    <div className="bg-warn-soft px-4 py-2 text-center text-xs font-medium text-warn">
      Demo mode: Supabase isn&apos;t connected yet, so this is sample data. See README.md to connect it.
    </div>
  );
}
