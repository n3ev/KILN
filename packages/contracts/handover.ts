import { z } from "zod";
import { OwnershipMode, Timestamp, VentureId } from "./primitives.js";

/**
 * Handover — CLAUDE.md §12.2.
 *
 * The customer must always be able to leave. This contract exists from day one
 * because retrofitting it is painful, and because a managed-asset model without
 * a guaranteed exit is not a premium service, it is a hostage situation.
 */

export const AssetKind = z.enum([
  "shopify-store",
  "domain",
  "stripe-account",
  "email-domain",
  "dns-zone",
  "social-handle",
  "ad-account",
  "analytics-property",
  "booking-account",
  "git-repository",
  "brand-assets",
]);
export type AssetKind = z.infer<typeof AssetKind>;

/** How a given asset actually moves. Per-provider mechanics differ a lot. */
export const TransferMechanism = z.enum([
  "ownership-change", // Shopify store owner change
  "auth-code-transfer", // domain registrar transfer
  "push-to-account", // registrar push
  "recreate-and-export", // Stripe: new account under customer entity + data export
  "zone-export", // DNS records handed over as a zone file
  "credential-handoff", // sealed credential delivery
  "repository-transfer", // git remote ownership
  "file-delivery", // source files, fonts, licences
]);

export const HandoverItem = z.object({
  /** Durable asset identity; labels and provider ids are not unique. */
  assetId: z.string().uuid().optional(),
  kind: AssetKind,
  provider: z.string().min(1).default("unknown"),
  externalId: z.string().min(1).optional(),
  ownershipMode: OwnershipMode.default("managed"),
  mechanism: TransferMechanism,
  label: z.string().min(1),
  /** Steps the customer must take. Written for a non-technical reader. */
  customerSteps: z.array(z.string().min(1)).default([]),
  /** Steps KILN executes automatically. */
  automatedSteps: z.array(z.string().min(1)).default([]),
  /** Verified how? Marking transferred without proof is how people get hurt. */
  verification: z.string().min(1),
  status: z.enum(["pending", "in-progress", "verified", "blocked", "not-applicable"]).default("pending"),
  blockedReason: z.string().optional(),
  estimatedBusinessDays: z.number().int().nonnegative().default(1),
});
export type HandoverItem = z.infer<typeof HandoverItem>;

export const ExportBundle = z.object({
  /** Everything the customer would need to run the business elsewhere. */
  includes: z.array(
    z.enum(["orders", "customers", "products", "content", "brand-assets", "financials", "site-source", "policies"]),
  ),
  /** Signed URL; short-lived for on-demand exports, long-lived for escrow. */
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().min(1),
  generatedAt: Timestamp,
  expiresAt: Timestamp.optional(),
});
export type ExportBundle = z.infer<typeof ExportBundle>;

export const HandoverPacket = z.object({
  ventureId: VentureId,
  reason: z.enum(["customer-requested", "plan-change", "scheduled-escrow", "platform-wind-down"]),
  fromMode: OwnershipMode,
  toMode: OwnershipMode,
  items: z.array(HandoverItem).min(1),
  export: ExportBundle,
  /** Published SLA: five business days. Recorded so it can be measured. */
  slaBusinessDays: z.number().int().positive().default(5),
  startedAt: Timestamp,
  targetCompletionAt: Timestamp,
  completedAt: Timestamp.optional(),
  /** Any quality gate that was overridden must be disclosed at handover. */
  disclosedOverrides: z.array(z.string()).default([]),
  runbookPath: z.string().default("docs/runbooks/handover.md"),
});
export type HandoverPacket = z.infer<typeof HandoverPacket>;

/**
 * Customer-generated break-glass key registration. The private half is never
 * accepted by this contract and must remain in the customer's custody.
 */
export const BreakGlassKeyAlgorithm = z.literal("x25519-hkdf-sha256+a256gcm");
export type BreakGlassKeyAlgorithm = z.infer<typeof BreakGlassKeyAlgorithm>;

export const BreakGlassPublicKeyRequest = z.object({
  publicKeyPem: z
    .string()
    .trim()
    .min(80)
    .max(4_096)
    .refine((value) => value.startsWith("-----BEGIN PUBLIC KEY-----"), "an X25519 public-key PEM is required")
    .refine((value) => !/PRIVATE KEY/i.test(value), "private keys must never be sent to KILN"),
});
export type BreakGlassPublicKeyRequest = z.infer<typeof BreakGlassPublicKeyRequest>;

export const BreakGlassPublicKeyRegistration = z.object({
  algorithm: BreakGlassKeyAlgorithm,
  fingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
  registeredAt: Timestamp,
});
export type BreakGlassPublicKeyRegistration = z.infer<typeof BreakGlassPublicKeyRegistration>;

/**
 * Plaintext exists only transiently inside the encryption boundary. In
 * particular, recovery material must never be persisted, logged, emitted as
 * an artifact, or returned from an API before it has been encrypted.
 */
export const BreakGlassPayload = z.object({
  packet: HandoverPacket,
  exportData: z.unknown(),
  recoveryMaterials: z.array(z.object({
    assetId: z.string().uuid(),
    label: z.string().min(1),
    value: z.string().min(1),
  })).default([]),
  generatedAt: Timestamp,
});
export type BreakGlassPayload = z.infer<typeof BreakGlassPayload>;

const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** Self-contained recipient-only envelope stored by KILN. */
export const EncryptedBreakGlassEnvelope = z.object({
  version: z.literal(1),
  algorithm: BreakGlassKeyAlgorithm,
  recipientKeyFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
  ephemeralPublicKeyPem: z.string().startsWith("-----BEGIN PUBLIC KEY-----"),
  salt: Base64,
  iv: Base64,
  authTag: Base64,
  ciphertext: Base64,
  generatedAt: Timestamp,
});
export type EncryptedBreakGlassEnvelope = z.infer<typeof EncryptedBreakGlassEnvelope>;

/**
 * Escrowed break-glass — §12.2.5. Encrypted to a public key the customer
 * generated at onboarding. KILN holds only the public half and therefore
 * cannot read the packet it stores.
 */
export const BreakGlassRecord = z.object({
  ventureId: VentureId,
  /** Fingerprint of the customer public key used for this immutable packet. */
  recipientKeyFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
  algorithm: BreakGlassKeyAlgorithm,
  storageKey: z.string().min(1),
  signedUrl: z.string().url().optional(),
  urlExpiresAt: Timestamp.optional(),
  packetChecksumSha256: z.string().min(1),
  emailedTo: z.string().email().optional(),
  generatedAt: Timestamp,
});
export type BreakGlassRecord = z.infer<typeof BreakGlassRecord>;

export function isHandoverComplete(p: HandoverPacket): boolean {
  return p.items.every((i) => i.status === "verified" || i.status === "not-applicable");
}
