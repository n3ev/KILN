import { item, type HandoverAdapter } from "../handover/types.js";

export const stripeHandover: HandoverAdapter = {
  id: "stripe",
  supports: (asset) => asset.kind === "stripe-account",
  plan: (asset) => item(asset, {
    mechanism: "recreate-and-export",
    customerSteps: [
      "Complete identity, tax, payout-bank, and representative checks on the customer-owned Stripe account.",
      "Approve the documented cutover window and perform a test payment and refund.",
    ],
    automatedSteps: [
      "Export historical payments, refunds, disputes, products, prices, and payout reconciliation.",
      "Move checkout and webhook destinations during the approved window without copying API keys.",
    ],
    verification: "A customer-owned account receives a test payout and historical balances reconcile to the export.",
    estimatedBusinessDays: 5,
  }),
};
