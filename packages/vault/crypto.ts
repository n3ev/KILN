import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "@kiln/config";
import { CredentialUnavailable } from "@kiln/contracts";
import { logger } from "@kiln/observability";
import sodium from "libsodium-wrappers";

interface KeyProvider {
  readonly id: "local" | "kms";
  wrap(dek: Uint8Array, accountId: string): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array, accountId: string): Promise<Uint8Array>;
}

function keyFilePath(): string {
  return config().KILN_KEYFILE ?? join(process.cwd(), ".kiln", "keys", "kek.key");
}

export function assertAccountId(accountId: string): void {
  if (accountId.trim().length === 0) throw new Error("accountId is required for vault encryption");
}

/**
 * Local development KEK. A distinct account wrapping key is derived from the
 * KEK, so moving ciphertext to a different account makes unwrapping fail.
 */
async function createLocalKeyProvider(): Promise<KeyProvider> {
  await sodium.ready;
  const path = keyFilePath();

  let kek: Uint8Array;
  if (existsSync(path)) {
    kek = new Uint8Array(readFileSync(path));
    if (kek.length !== sodium.crypto_secretbox_KEYBYTES) {
      throw new Error(`Local vault KEK at ${path} has ${kek.length} bytes; expected ${sodium.crypto_secretbox_KEYBYTES}.`);
    }
  } else {
    kek = sodium.crypto_secretbox_keygen();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(kek), { mode: 0o600 });
    logger.warn("generated a local development KEK", { path, note: "never use this in production" });
  }

  const accountKey = (accountId: string): Uint8Array => {
    assertAccountId(accountId);
    return sodium.crypto_generichash(
      sodium.crypto_secretbox_KEYBYTES,
      sodium.from_string(`kiln:vault:v1:account:${accountId}`),
      kek,
    );
  };

  return {
    id: "local",
    async wrap(dek, accountId) {
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const boxed = sodium.crypto_secretbox_easy(dek, nonce, accountKey(accountId));
      const out = new Uint8Array(nonce.length + boxed.length);
      out.set(nonce, 0);
      out.set(boxed, nonce.length);
      return out;
    },
    async unwrap(wrapped, accountId) {
      const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
      if (wrapped.length <= nonceBytes) throw new Error("wrapped DEK is truncated");
      const nonce = wrapped.slice(0, nonceBytes);
      const boxed = wrapped.slice(nonceBytes);
      return sodium.crypto_secretbox_open_easy(boxed, nonce, accountKey(accountId));
    },
  };
}

async function keyProvider(): Promise<KeyProvider> {
  const cfg = config();
  if (cfg.KEY_PROVIDER === "kms") {
    throw new Error("KEY_PROVIDER=kms is not implemented. See docs/adr/0004-vault-architecture.md.");
  }
  if (cfg.NODE_ENV === "production") {
    throw new Error("KEY_PROVIDER=local is forbidden in production; configure the KMS provider before launch.");
  }
  return createLocalKeyProvider();
}

export interface SealedCredential {
  readonly ciphertext: Uint8Array;
  readonly dekWrapped: Uint8Array;
  readonly nonce: Uint8Array;
}

/** Encrypts a secret without persisting it. */
export async function seal(plaintext: string, accountId: string): Promise<SealedCredential> {
  assertAccountId(accountId);
  if (plaintext.length === 0) throw new Error("credential plaintext must not be empty");
  await sodium.ready;
  const provider = await keyProvider();
  const dek = sodium.crypto_secretbox_keygen();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, dek);
  const dekWrapped = await provider.wrap(dek, accountId);
  return { ciphertext, dekWrapped, nonce };
}

export async function unseal(
  sealed: SealedCredential,
  accountId: string,
  providerName: string,
  assetId?: string,
): Promise<string> {
  await sodium.ready;
  const provider = await keyProvider();
  try {
    const dek = await provider.unwrap(sealed.dekWrapped, accountId);
    return sodium.to_string(sodium.crypto_secretbox_open_easy(sealed.ciphertext, sealed.nonce, dek));
  } catch {
    throw new CredentialUnavailable(providerName, assetId, "credential decryption failed");
  }
}
