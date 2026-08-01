import {
  ExportBundle,
  HandoverPacket,
  OwnershipMode,
  type ExportBundle as ExportBundleValue,
  type HandoverPacket as HandoverPacketValue,
} from "@kiln/contracts";
import { z } from "zod";
import { assetsHandover } from "../assets/handover.js";
import { domainHandover } from "../domain/handover.js";
import { emailHandover } from "../email/handover.js";
import { shopifyHandover } from "../shopify/handover.js";
import { stripeHandover } from "../stripe/handover.js";
import { HandoverAssetSnapshot, type HandoverAdapter } from "./types.js";

const Input = z.object({
  ventureId: z.string().uuid(),
  reason: z.enum(["customer-requested", "plan-change", "scheduled-escrow", "platform-wind-down"]),
  fromMode: OwnershipMode,
  assets: z.array(HandoverAssetSnapshot).min(1),
  export: ExportBundle,
  disclosedOverrides: z.array(z.string()).default([]),
  startedAt: z.string().datetime(),
});

const adapters: readonly HandoverAdapter[] = [shopifyHandover, domainHandover, stripeHandover, emailHandover, assetsHandover];

function addBusinessDays(iso: string, count: number): string {
  const date = new Date(iso);
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date.toISOString();
}

export function assembleHandoverPacket(inputRaw: {
  ventureId: string;
  reason: "customer-requested" | "plan-change" | "scheduled-escrow" | "platform-wind-down";
  fromMode: "managed" | "delegated" | "transferred";
  assets: readonly HandoverAssetSnapshot[];
  export: ExportBundleValue;
  disclosedOverrides?: readonly string[];
  startedAt: string;
}): HandoverPacketValue {
  const input = Input.parse(inputRaw);
  const sorted = [...input.assets].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  const items = sorted.map((asset) => {
    const adapter = adapters.find((candidate) => candidate.supports(asset));
    if (!adapter) throw new Error(`No handover adapter supports ${asset.kind} (${asset.id}).`);
    return adapter.plan(asset);
  });
  return HandoverPacket.parse({
    ventureId: input.ventureId,
    reason: input.reason,
    fromMode: input.fromMode,
    toMode: "transferred",
    items,
    export: input.export,
    slaBusinessDays: 5,
    startedAt: input.startedAt,
    targetCompletionAt: addBusinessDays(input.startedAt, 5),
    disclosedOverrides: input.disclosedOverrides,
    runbookPath: "docs/runbooks/handover.md",
  });
}
