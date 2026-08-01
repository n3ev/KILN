import { createHash, createPublicKey, type KeyObject } from "node:crypto";

export const BREAK_GLASS_ALGORITHM = "x25519-hkdf-sha256+a256gcm" as const;

export class InvalidBreakGlassKey extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBreakGlassKey";
  }
}

function assertPublicPem(pem: string): void {
  if (/PRIVATE KEY/i.test(pem)) {
    throw new InvalidBreakGlassKey("Private keys must never be sent to or stored by KILN.");
  }
  if (!pem.trim().startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new InvalidBreakGlassKey("Expected an X25519 public key in SPKI PEM format.");
  }
}

function assertX25519(key: KeyObject): void {
  if (key.asymmetricKeyType !== "x25519") {
    throw new InvalidBreakGlassKey("The break-glass key must use X25519.");
  }
}

export function parseCustomerPublicKey(pem: string): KeyObject {
  assertPublicPem(pem);
  try {
    const key = createPublicKey(pem.trim());
    assertX25519(key);
    return key;
  } catch (error) {
    if (error instanceof InvalidBreakGlassKey) throw error;
    throw new InvalidBreakGlassKey("The supplied X25519 public key could not be parsed.");
  }
}

export function normaliseCustomerPublicKey(pem: string): string {
  return parseCustomerPublicKey(pem).export({ format: "pem", type: "spki" }).toString();
}

export function publicKeyFingerprintSha256(pemOrKey: string | KeyObject): string {
  const key = typeof pemOrKey === "string" ? parseCustomerPublicKey(pemOrKey) : pemOrKey;
  assertX25519(key);
  const der = key.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}
