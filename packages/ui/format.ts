/**
 * Display formatting.
 *
 * CLAUDE.md §6.1: all money is integer micros, and formatting happens ONCE, in
 * this package. A `toFixed(2)` anywhere else is a bug — it is how a currency
 * ends up rendered three different ways on one screen.
 */

export function formatMicros(micros: number, currency = "GBP", locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(micros) < 1_000_000 ? 2 : 0,
  }).format(micros / 1_000_000);
}

export function formatCents(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function formatCount(n: number, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 2 : 1)}%`;
}

/** Relative time that degrades honestly rather than claiming freshness. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
