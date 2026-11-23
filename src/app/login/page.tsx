import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, Field, Logo, btn, inputCls } from "@/components/ui";
import { getCurrentSeller } from "@/lib/data";
import { sendMagicLink } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const instant = false;

const ERRORS: Record<string, string> = {
  setup: "Sign-in isn't available until Supabase is connected. Follow the steps in README.md.",
  email: "Enter a valid email address, like ada@example.com.",
  send: "We couldn't send the sign-in email. Wait a minute and try again.",
  link: "That sign-in link has expired or was already used. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { user } = await getCurrentSeller();
  if (user) redirect("/dashboard");
  const sp = await searchParams;
  const sent = typeof sp.sent === "string" ? sp.sent : null;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <Card className="flex flex-col gap-4 p-6">
        {sent ? (
          <>
            <h1 className="font-display text-2xl font-bold">Check your email</h1>
            <p className="text-sm text-muted">
              We sent a sign-in link to <b className="text-ink">{sent}</b>. Open it on this device to continue.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Create your Kola link</h1>
            <p className="text-sm text-muted">Enter your email and we&apos;ll send you a sign-in link. No password needed.</p>
            {error && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
            <form action={sendMagicLink} className="flex flex-col gap-4">
              <Field label="Email">
                <input name="email" type="email" required autoComplete="email" placeholder="ada@example.com" className={inputCls} />
              </Field>
              <button className={btn.primary}>Send sign-in link</button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
