/**
 * The Reclip mark: a receipt with a torn bottom edge and a check, folded into the shoulder of
 * an R, on the dark rounded tile from the brand sheet (`public/logo.png`). The tile carries its
 * own background, so the same file reads correctly on both the light and dark themes.
 */
export function ReclipMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed, tiny brand asset
    <img src="/logo.png" width={size} height={size} alt="" aria-hidden="true" className={className} />
  );
}

/**
 * The full lockup from the brand sheet: mark, "Reclip" wordmark and tagline
 * (`public/logo-full.png`, 616 x 219). It is artwork on a white ground, so `.logo-full`
 * gives it a white chip in dark mode instead of letting the navy lettering vanish.
 */
export function ReclipLogoFull({ height = 44, className = '' }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed brand asset
    <img
      src="/logo-full.png"
      alt="Reclip: Receipts in. Reconciliation done."
      height={height}
      width={Math.round((height * 616) / 219)}
      className={`logo-full ${className}`}
    />
  );
}

export function ReclipWordmark({ className = '', showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <ReclipMark size={34} />
      <span className="flex flex-col leading-none">
        <span className="text-[1.05rem] font-semibold tracking-tight">Reclip</span>
        {showTagline && (
          <span className="mt-1 text-[0.65rem]" style={{ color: 'var(--text-subtle)' }}>
            Receipts in. Reconciliation done.
          </span>
        )}
      </span>
    </span>
  );
}
