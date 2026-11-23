import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, Field, Logo, btn, inputCls } from "@/components/ui";
import { getCurrentSeller } from "@/lib/data";
import { createProfile } from "./actions";

export const metadata: Metadata = { title: "Set up your link" };
export const instant = false;

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { user, profile } = await getCurrentSeller();
  if (!user) redirect("/login");
  if (profile) redirect("/dashboard");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="font-display text-2xl font-bold">Choose your link</h1>
        <p className="text-sm text-muted">This is what you&apos;ll put in your Instagram bio and WhatsApp status.</p>
        {str("error") && <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{str("error")}</p>}
        <form action={createProfile} className="flex flex-col gap-4">
          <Field label="Your link" hint="Letters, numbers and underscores only.">
            <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-indigo">
              <span className="pl-3 font-mono text-sm text-muted">kola.link/</span>
              <input
                name="handle"
                required
                minLength={3}
                maxLength={30}
                pattern="@?[A-Za-z0-9_]{3,30}"
                defaultValue={str("handle")}
                placeholder="toluadire"
                className="w-full bg-transparent py-2.5 pr-3 font-mono text-sm text-ink focus:outline-none"
              />
            </div>
          </Field>
          <Field label="Shop or creator name">
            <input name="display_name" required minLength={2} maxLength={60} defaultValue={str("name")} placeholder="Tolu's Adire House" className={inputCls} />
          </Field>
          <Field label="Location (optional)">
            <input name="location" maxLength={80} placeholder="Abeokuta, Ogun" className={inputCls} />
          </Field>
          <Field label="Short bio (optional)">
            <textarea name="bio" maxLength={280} rows={3} placeholder="What you sell and where you deliver" className={inputCls} />
          </Field>
          <button className={btn.primary}>Create my link</button>
        </form>
      </Card>
    </main>
  );
}
