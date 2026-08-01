import {
  createCipheriv,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  BreakGlassPayload,
  EncryptedBreakGlassEnvelope,
  type BreakGlassPayload as BreakGlassPayloadValue,
  type EncryptedBreakGlassEnvelope as EncryptedBreakGlassEnvelopeValue,
} from "@kiln/contracts";
import { BREAK_GLASS_ALGORITHM, parseCustomerPublicKey, publicKeyFingerprintSha256 } from "./key.js";

const INFO = Buffer.from("kiln:break-glass:v1", "utf8");
const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;

function aad(fingerprint: string, generatedAt: string): Buffer {
  return Buffer.from(`kiln-break-glass\0v1\0${BREAK_GLASS_ALGORITHM}\0${fingerprint}\0${generatedAt}`, "utf8");
}

/**
 * Encrypts in memory directly to the customer's X25519 public key. The
 * ephemeral private key, shared secret, AES key, and plaintext buffer are
 * zeroed or released before this function returns; only the envelope may be
 * persisted.
 */
export function encryptBreakGlassPayload(
  payloadInput: BreakGlassPayloadValue,
  recipientPublicKeyPem: string,
): EncryptedBreakGlassEnvelopeValue {
  const payload = BreakGlassPayload.parse(payloadInput);
  const recipient = parseCustomerPublicKey(recipientPublicKeyPem);
  const fingerprint = publicKeyFingerprintSha256(recipient);
  const { publicKey: ephemeralPublic, privateKey: ephemeralPrivate } = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({ privateKey: ephemeralPrivate, publicKey: recipient });
  const salt = randomBytes(32);
  const key = Buffer.from(hkdfSync("sha256", sharedSecret, salt, INFO, 32));
  const iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    sharedSecret.fill(0);
    key.fill(0);
    plaintext.fill(0);
    throw new Error(`Break-glass payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  }

  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(fingerprint, payload.generatedAt));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return EncryptedBreakGlassEnvelope.parse({
      version: 1,
      algorithm: BREAK_GLASS_ALGORITHM,
      recipientKeyFingerprintSha256: fingerprint,
      ephemeralPublicKeyPem: ephemeralPublic.export({ format: "pem", type: "spki" }).toString(),
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      generatedAt: payload.generatedAt,
    });
  } finally {
    sharedSecret.fill(0);
    key.fill(0);
    plaintext.fill(0);
  }
}

export const breakGlassAad = aad;
