import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, type KeyObject } from "node:crypto";
import {
  BreakGlassPayload,
  EncryptedBreakGlassEnvelope,
  type BreakGlassPayload as BreakGlassPayloadValue,
  type EncryptedBreakGlassEnvelope as EncryptedBreakGlassEnvelopeValue,
} from "@kiln/contracts";
import { breakGlassAad } from "./encryption.js";
import { InvalidBreakGlassKey, publicKeyFingerprintSha256 } from "./key.js";

const INFO = Buffer.from("kiln:break-glass:v1", "utf8");

function parseCustomerPrivateKey(pem: string): KeyObject {
  if (!/-----BEGIN PRIVATE KEY-----/.test(pem)) {
    throw new InvalidBreakGlassKey("Expected an X25519 private key in PKCS#8 PEM format.");
  }
  try {
    const key = createPrivateKey(pem.trim());
    if (key.asymmetricKeyType !== "x25519") throw new InvalidBreakGlassKey("The break-glass key must use X25519.");
    return key;
  } catch (error) {
    if (error instanceof InvalidBreakGlassKey) throw error;
    throw new InvalidBreakGlassKey("The supplied X25519 private key could not be parsed.");
  }
}

/** Customer-side recovery helper. KILN does not possess the required key. */
export function decryptBreakGlassPayload(
  envelopeInput: EncryptedBreakGlassEnvelopeValue,
  customerPrivateKeyPem: string,
): BreakGlassPayloadValue {
  const envelope = EncryptedBreakGlassEnvelope.parse(envelopeInput);
  const recipientPrivate = parseCustomerPrivateKey(customerPrivateKeyPem);
  const recipientPublic = createPublicKey(recipientPrivate);
  const fingerprint = publicKeyFingerprintSha256(recipientPublic);
  if (fingerprint !== envelope.recipientKeyFingerprintSha256) {
    throw new Error("This private key does not match the break-glass packet recipient.");
  }

  const ephemeralPublic = createPublicKey(envelope.ephemeralPublicKeyPem);
  if (ephemeralPublic.asymmetricKeyType !== "x25519") throw new Error("Invalid ephemeral break-glass key.");
  const sharedSecret = diffieHellman({ privateKey: recipientPrivate, publicKey: ephemeralPublic });
  const key = Buffer.from(hkdfSync("sha256", sharedSecret, Buffer.from(envelope.salt, "base64"), INFO, 32));
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(breakGlassAad(fingerprint, envelope.generatedAt));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return BreakGlassPayload.parse(JSON.parse(plaintext.toString("utf8")) as unknown);
  } finally {
    sharedSecret.fill(0);
    key.fill(0);
    plaintext?.fill(0);
  }
}
