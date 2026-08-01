import { generateKeyPairSync } from "node:crypto";
import { AssetKind, BreakGlassPayload, type ExportBundle } from "@kiln/contracts";
import { describe, expect, it } from "vitest";
import {
  assembleHandoverPacket,
  encryptBreakGlassPayload,
  InvalidBreakGlassKey,
  normaliseCustomerPublicKey,
  publicKeyFingerprintSha256,
} from "../index.js";
import { decryptBreakGlassPayload } from "../handover/decrypt.js";

const ids = {
  venture: "11111111-1111-4111-8111-111111111111",
  asset: "22222222-2222-4222-8222-222222222222",
};
const startedAt = "2026-07-31T08:00:00.000Z";
const exportBundle: ExportBundle = {
  includes: ["orders", "customers", "products", "content", "brand-assets", "financials", "site-source", "policies"],
  storageKey: "break-glass://packet/test#exportData",
  sizeBytes: 128,
  checksumSha256: "a".repeat(64),
  generatedAt: startedAt,
};

function customerKeys() {
  const pair = generateKeyPairSync("x25519");
  return {
    publicPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    privatePem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

describe("handover packet assembly", () => {
  it("plans every supported asset kind and counts five business days", () => {
    const assets = AssetKind.options.map((kind, index) => ({
      id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
      kind,
      provider: kind === "shopify-store" ? "shopify" : kind === "stripe-account" ? "stripe" : "fixture",
      displayName: `${kind} fixture`,
      ownershipMode: "managed" as const,
      status: "active" as const,
    }));
    const packet = assembleHandoverPacket({
      ventureId: ids.venture,
      reason: "customer-requested",
      fromMode: "managed",
      assets,
      export: exportBundle,
      startedAt,
    });

    expect(packet.items).toHaveLength(AssetKind.options.length);
    expect(packet.items.every((entry) => entry.assetId && entry.provider && entry.verification)).toBe(true);
    expect(Object.fromEntries(packet.items.map((entry) => [entry.kind, entry.mechanism]))).toMatchObject({
      "shopify-store": "ownership-change",
      domain: "auth-code-transfer",
      "stripe-account": "recreate-and-export",
      "email-domain": "zone-export",
      "dns-zone": "zone-export",
      "brand-assets": "file-delivery",
      "git-repository": "repository-transfer",
    });
    expect(packet.targetCompletionAt).toBe("2026-08-07T08:00:00.000Z");
  });
});

describe("recipient-only break-glass encryption", () => {
  it("round-trips recovery material without exposing it in the stored envelope", () => {
    const keys = customerKeys();
    const publicPem = normaliseCustomerPublicKey(keys.publicPem);
    const packet = assembleHandoverPacket({
      ventureId: ids.venture,
      reason: "scheduled-escrow",
      fromMode: "managed",
      assets: [{ id: ids.asset, kind: "domain", provider: "registrar", displayName: "example.test", ownershipMode: "managed", status: "active" }],
      export: exportBundle,
      startedAt,
    });
    const payload = BreakGlassPayload.parse({
      packet,
      exportData: { products: [{ sku: "SKU-1" }] },
      recoveryMaterials: [{ assetId: ids.asset, label: "registrar transfer code", value: "never-persist-this-plaintext" }],
      generatedAt: startedAt,
    });

    const envelope = encryptBreakGlassPayload(payload, publicPem);
    const persisted = JSON.stringify(envelope);
    expect(persisted).not.toContain("never-persist-this-plaintext");
    expect(persisted).not.toContain(keys.privatePem);
    expect(envelope.recipientKeyFingerprintSha256).toBe(publicKeyFingerprintSha256(publicPem));
    expect(decryptBreakGlassPayload(envelope, keys.privatePem)).toEqual(payload);
    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}` };
    expect(() => decryptBreakGlassPayload(tampered, keys.privatePem)).toThrow();
  });

  it("rejects private keys at the registration boundary and wrong recipient keys at recovery", () => {
    const first = customerKeys();
    const second = customerKeys();
    expect(() => normaliseCustomerPublicKey(first.privatePem)).toThrow(InvalidBreakGlassKey);

    const packet = assembleHandoverPacket({
      ventureId: ids.venture,
      reason: "customer-requested",
      fromMode: "managed",
      assets: [{ id: ids.asset, kind: "domain", provider: "registrar", displayName: "example.test", ownershipMode: "managed", status: "active" }],
      export: exportBundle,
      startedAt,
    });
    const payload = BreakGlassPayload.parse({ packet, exportData: {}, recoveryMaterials: [], generatedAt: startedAt });
    const envelope = encryptBreakGlassPayload(payload, first.publicPem);
    expect(() => decryptBreakGlassPayload(envelope, second.privatePem)).toThrow(/does not match/);
  });
});
