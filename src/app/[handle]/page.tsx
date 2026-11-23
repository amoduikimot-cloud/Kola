import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoBanner, Logo, Pill } from "@/components/ui";
import { TrustRing } from "@/components/trust-ring";
import { getSellerByHandle } from "@/lib/data";
import { trustLabel, trustScore } from "@/lib/trust";
import { Cart } from "./cart";

type Props = { params: Promise<{ handle: string }> };

// Seller data changes often (new products, new orders), so render per request.
export const instant = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const seller = await getSellerByHandle(handle);
  if (!seller) return { title: "Link not found" };
  return {
    title: seller.profile.display_name,
    description: seller.profile.bio ?? `Pay ${seller.profile.display_name} safely with Kola escrow.`,
  };
}

export default async function SellerLinkPage({ params }: Props) {
  const { handle } = await params;
  const seller = await getSellerByHandle(handle);
  if (!seller) notFound();
  const { profile, products, demo } = seller;
  const score = trustScore(profile);
  const initials = profile.display_name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const since = new Date(profile.created_at).getFullYear();

  return (
    <>
      {demo && <DemoBanner />}
      <main className="mx-auto w-full max-w-md flex-1 bg-surface sm:my-8 sm:overflow-hidden sm:rounded-3xl sm:border sm:border-line">
        <div className="adire h-24" aria-hidden="true" />
        <div className="-mt-9 flex flex-col gap-2 px-4">
          <div className="grid h-[72px] w-[72px] place-items-center rounded-2xl border-4 border-surface bg-kola font-display text-2xl font-extrabold text-white">
            {initials}
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight">{profile.display_name}</h1>
          <p className="text-sm text-muted">
            @{profile.handle}
            {profile.location ? ` · ${profile.location}` : ""}
          </p>
          {profile.bio && <p className="text-sm">{profile.bio}</p>}
          <div className="flex flex-wrap gap-1.5">
            {profile.id_verified ? <Pill tone="ok">ID verified</Pill> : <Pill tone="warn">ID not verified yet</Pill>}
            <Pill tone="kola">On Kola since {since}</Pill>
          </div>
        </div>

        <section className="m-4 flex items-center gap-4 rounded-2xl border border-line p-4">
          <TrustRing score={score} />
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2">
            <div className="col-span-2 text-sm font-semibold">{trustLabel(score)}</div>
            <Stat value={profile.completed_orders.toLocaleString()} label="orders completed" />
            <Stat
              value={`${profile.disputes_total}`}
              label={profile.disputes_total === 1 ? "dispute" : "disputes"}
            />
          </div>
        </section>

        <Cart
          handle={profile.handle}
          sellerName={profile.display_name}
          deliveryKobo={profile.delivery_fee_kobo}
          products={products.map(({ id, name, description, price_kobo }) => ({ id, name, description, price_kobo }))}
        />
      </main>
      <footer className="flex justify-center py-6">
        <Logo />
      </footer>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-base font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
