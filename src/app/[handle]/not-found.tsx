import Link from "next/link";
import { btn } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-3xl font-bold">This Kola link doesn&apos;t exist</h1>
      <p className="text-muted">Check the spelling, or ask the seller to send their link again.</p>
      <Link href="/" className={btn.ghost}>
        Go to Kola
      </Link>
    </main>
  );
}
