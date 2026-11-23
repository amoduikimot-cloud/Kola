import Link from "next/link";
import { Logo, btn, Card } from "@/components/ui";
import { getCurrentSeller } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Reads the sign-in cookie, so render per request (see Next.js "instant" route config).
export const instant = false;

const STEPS = [
  { title: "You share your link", body: "Put kola.link/yourname in your Instagram bio, WhatsApp status or TikTok." },
  { title: "Buyers pay into escrow", body: "Kola holds the money, so buyers aren't afraid to pay a stranger." },
  { title: "You get paid on delivery", body: "When the buyer confirms, the money is released and your trust score grows." },
];

export default async function Home() {
  const { user } = await getCurrentSeller();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <Logo />
        <Link href={user ? "/dashboard" : "/login"} className={`${btn.ghost} !py-2`}>
          {user ? "Dashboard" : "Sign in"}
        </Link>
      </header>

      <section className="flex max-w-2xl flex-col gap-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-kola">For sellers, creators and influencers</p>
        <h1 className="font-display text-5xl font-extrabold leading-none tracking-tight text-balance sm:text-6xl">
          Send your <span className="text-indigo">Kola</span> link.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          One link to sell, get paid and build trust. Buyers pay into escrow and you get paid when the order arrives.
          Every completed order adds to a trust score that buyers can see.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={user ? "/dashboard" : "/login"} className={btn.primary}>
            Create your link
          </Link>
          <Link href="/toluadire" className={btn.ghost}>
            See an example
          </Link>
        </div>
        {!isSupabaseConfigured && (
          <p className="text-sm text-muted">
            Demo mode: Supabase isn&apos;t connected yet. The example link works; sign-in needs the setup in README.md.
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <Card key={s.title} className="flex flex-col gap-2">
            <span className="font-mono text-xs text-kola">Step {i + 1}</span>
            <h2 className="font-display text-lg font-bold">{s.title}</h2>
            <p className="text-sm text-muted">{s.body}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
