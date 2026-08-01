import { item, type HandoverAdapter } from "../handover/types.js";

export const emailHandover: HandoverAdapter = {
  id: "email",
  supports: (asset) => asset.kind === "email-domain",
  plan: (asset) => item(asset, {
    mechanism: "zone-export",
    customerSteps: ["Create the destination sender account and verify a customer-controlled recovery address."],
    automatedSteps: ["Export sender-domain DNS, templates, consent records, and suppression lists; credentials are reissued, never copied in plaintext."],
    verification: "SPF, DKIM, and DMARC pass and the customer receives a controlled test message from the destination account.",
    estimatedBusinessDays: 2,
  }),
};
