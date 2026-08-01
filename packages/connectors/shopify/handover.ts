import { item, type HandoverAdapter } from "../handover/types.js";

export const shopifyHandover: HandoverAdapter = {
  id: "shopify",
  supports: (asset) => asset.kind === "shopify-store",
  plan: (asset) => item(asset, {
    mechanism: "ownership-change",
    customerSteps: [
      "Accept the Shopify owner invitation and enable multi-factor authentication.",
      "Add a customer-controlled billing method before the agreed cutover.",
      "Sign in as store owner and confirm products, orders, domains, and apps are visible.",
    ],
    automatedSteps: [
      "Export the catalogue and order history before the ownership change.",
      "Detach KILN billing and remove KILN staff accounts only after customer verification.",
    ],
    verification: "The customer signs in as owner and KILN no longer has an owner or staff session.",
    estimatedBusinessDays: 2,
  }),
};
