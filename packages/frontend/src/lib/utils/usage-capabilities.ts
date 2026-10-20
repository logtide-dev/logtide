import type { CapabilityUsage } from '$lib/api/usage';

/** The combined quota of hosted plans. */
const TELEMETRY_QUOTA = 'telemetry.max_bytes_monthly';

/**
 * Rows of the Usage page capability card, in display order.
 *
 * Capabilities with a configured limit come first (the actionable ones),
 * unlimited ones after; stable within each group by registry order.
 *
 * Only when the combined telemetry.max_bytes_monthly quota has a limit (the
 * hosted plan case) are the quotas left at null hidden: listing every
 * per-signal meter as "Unlimited" next to the plan quota is noise. In every
 * other case (self-hosted default, or a self-hoster who capped one quota)
 * every row stays, exactly as before.
 */
export function visibleCapabilities(caps: CapabilityUsage[]): CapabilityUsage[] {
  const telemetryCapped = caps.some((c) => c.capability === TELEMETRY_QUOTA && c.limit !== null);
  const rows = telemetryCapped ? caps.filter((c) => !(c.kind === 'quota' && c.limit === null)) : caps;
  return [...rows].sort((a, b) => (a.limit === null ? 1 : 0) - (b.limit === null ? 1 : 0));
}

/** Byte counts as the Usage page shows them (binary units). */
export function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Percent of a capability used. Only a null limit means unlimited (no
 * percentage). A limit of 0 is the opposite (fully restricted), so it must
 * render as at/over limit, not unlimited. Capped at 999 to avoid runaway labels.
 */
export function capPercent(c: { current: number; limit: number | null }): number | null {
  if (c.limit === null) return null;
  if (c.limit <= 0) return c.current > 0 ? 999 : 100;
  return Math.min(999, Math.round((c.current / c.limit) * 100));
}

/** Bar color: green < 80%, amber 80-99%, red >= 100% (over limit). */
export function capBarColor(pct: number): string {
  if (pct >= 100) return 'bg-destructive';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-green-500';
}
