import { item, type HandoverAdapter } from "../handover/types.js";

export const assetsHandover: HandoverAdapter = {
  id: "assets",
  supports: () => true,
  plan: (asset) => {
    if (asset.kind === "git-repository") {
      return item(asset, {
        mechanism: "repository-transfer",
        customerSteps: ["Accept the repository transfer into a customer-owned organisation and add a recovery administrator."],
        automatedSteps: ["Transfer the full Git history, release tags, deployment notes, and dependency lockfiles."],
        verification: "The customer can clone, build, deploy, and roll back without a KILN credential.",
        estimatedBusinessDays: 1,
      });
    }
    if (asset.kind === "brand-assets") {
      return item(asset, {
        mechanism: "file-delivery",
        customerSteps: ["Download and open the source bundle before acknowledging receipt."],
        automatedSteps: ["Package editable sources, originals, copy in Markdown, and font/image licence evidence."],
        verification: "Checksums match and the customer confirms the source files and licence documents open.",
        estimatedBusinessDays: 1,
      });
    }
    return item(asset, {
      mechanism: asset.kind === "social-handle" || asset.kind === "ad-account" || asset.kind === "analytics-property"
        ? "ownership-change"
        : "push-to-account",
      customerSteps: ["Create or nominate the destination owner account and enable multi-factor authentication."],
      automatedSteps: ["Invite the destination owner and remove KILN access only after verification; credentials are reissued directly by the provider."],
      verification: "The customer can administer the asset and KILN has no residual write access.",
      estimatedBusinessDays: 2,
    });
  },
};
