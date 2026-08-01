import type { StripeEvent } from "./types.js";

export interface BillingLifecycleHooks {
  onInvoicePaid(event: StripeEvent): Promise<void>;
  onPaymentFailed(event: StripeEvent): Promise<void>;
  onSubscriptionChanged(event: StripeEvent): Promise<void>;
  onTrialWillEnd(event: StripeEvent): Promise<void>;
}

/**
 * TODO(prompt-3): implement dunning timers, proration policy, metered credit
 * grants, and customer notifications behind these hooks. Prompt 1 persists the
 * lifecycle correctly and leaves these money-moving policies inert.
 */
export const promptOneLifecycleHooks: BillingLifecycleHooks = {
  async onInvoicePaid() {},
  async onPaymentFailed() {},
  async onSubscriptionChanged() {},
  async onTrialWillEnd() {},
};

