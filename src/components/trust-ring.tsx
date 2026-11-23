export function TrustRing({ score }: { score: number }) {
  const c = 2 * Math.PI * 26;
  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`Trust score ${score} out of 100`}>
      <svg viewBox="0 0 64 64" className="h-20 w-20 -rotate-90">
        <circle cx="32" cy="32" r="26" fill="none" stroke="var(--ok-soft)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r="26"
          fill="none"
          stroke="var(--ok)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <div className="font-display text-2xl font-extrabold text-ok">{score}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-widest text-muted">Trust</div>
        </div>
      </div>
    </div>
  );
}
