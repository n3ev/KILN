import { config } from "./env.js";

/**
 * Feature flags.
 *
 * `liveOnly` flags gate code paths that touch a real partner account. They are
 * off unless a credential exists AND sandbox mode is off, so an accidental
 * `KILN_SANDBOX=0` on a laptop still cannot place a real order.
 */
export const FLAGS = {
  /** Live Shopify provisioning. Simulated twin is always available. */
  shopifyLiveProvisioning: { liveOnly: true, default: false },
  /** Live domain registration (spends money). */
  domainRegistration: { liveOnly: true, default: false },
  /** Live ad-account creation and spend. */
  paidChannels: { liveOnly: true, default: false },
  /** Print-on-demand supplier adapters hitting real APIs. */
  supplierLiveQuotes: { liveOnly: true, default: false },
  /** Write-capable MCP surface. Prompt 2 work — see CLAUDE.md §9.4. */
  mcpWriteAccess: { liveOnly: true, default: false },
  /** Escrowed break-glass packet cron. Wired in prompt 5. */
  breakGlassSchedule: { liveOnly: false, default: false },
  /** Operator agent may execute proposals, not merely propose them. */
  operatorAutoExecute: { liveOnly: false, default: false },
} as const satisfies Record<string, { liveOnly: boolean; default: boolean }>;

export type FlagName = keyof typeof FLAGS;

export function isEnabled(flag: FlagName, overrides: Partial<Record<FlagName, boolean>> = {}): boolean {
  const spec = FLAGS[flag];
  const override = overrides[flag];
  const base = override ?? spec.default;
  if (!base) return false;
  if (spec.liveOnly && config().sandbox) return false;
  return true;
}
