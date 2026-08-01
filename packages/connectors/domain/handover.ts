import { item, type HandoverAdapter } from "../handover/types.js";

export const domainHandover: HandoverAdapter = {
  id: "domain",
  supports: (asset) => asset.kind === "domain" || asset.kind === "dns-zone",
  plan: (asset) => asset.kind === "dns-zone"
    ? item(asset, {
        mechanism: "zone-export",
        customerSteps: ["Import the supplied zone into the destination DNS provider and keep the verification records intact."],
        automatedSteps: ["Export the complete DNS zone and document TTL, mail, certificate, and verification records."],
        verification: "Web, checkout, email authentication, and certificate records resolve from the destination zone.",
        estimatedBusinessDays: 2,
      })
    : item(asset, {
        mechanism: "auth-code-transfer",
        customerSteps: ["Open the destination registrar account and start the inbound transfer during the agreed window."],
        automatedSteps: ["Confirm the transfer lock, registrant details, renewal date, and provide the auth code through the recipient-only packet."],
        verification: "The destination registrar lists the customer as registrant and permits renewal and DNS changes.",
        estimatedBusinessDays: 5,
      }),
};
