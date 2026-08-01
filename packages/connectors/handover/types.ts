import { AssetKind, HandoverItem, OwnershipMode, type HandoverItem as HandoverItemValue } from "@kiln/contracts";
import { z } from "zod";

/** Secret-free projection of an asset used to construct a transfer plan. */
export const HandoverAssetSnapshot = z.object({
  id: z.string().uuid(),
  kind: AssetKind,
  provider: z.string().min(1),
  externalId: z.string().min(1).optional(),
  displayName: z.string().min(1),
  ownershipMode: OwnershipMode,
  status: z.enum(["provisioning", "active", "suspended", "transferring", "released", "failed"]),
});
export type HandoverAssetSnapshot = z.infer<typeof HandoverAssetSnapshot>;

export interface HandoverAdapter {
  readonly id: string;
  supports(asset: HandoverAssetSnapshot): boolean;
  plan(asset: HandoverAssetSnapshot): HandoverItemValue;
}

export function item(
  asset: HandoverAssetSnapshot,
  details: Omit<HandoverItemValue, "assetId" | "kind" | "provider" | "externalId" | "ownershipMode" | "label" | "status">,
): HandoverItemValue {
  return HandoverItem.parse({
    assetId: asset.id,
    kind: asset.kind,
    provider: asset.provider,
    ...(asset.externalId ? { externalId: asset.externalId } : {}),
    ownershipMode: asset.ownershipMode,
    label: asset.displayName,
    status: asset.status === "released" || asset.ownershipMode === "transferred" ? "verified" : "pending",
    ...details,
  });
}
