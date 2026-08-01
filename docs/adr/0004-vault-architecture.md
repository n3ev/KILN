# ADR 0004: Credential vault

- Status: Accepted architecture; production KMS pending
- Date: 2026-08-01

## Context

KILN needs connector credentials without making secrets available to agents,
prompts, browser code, logs, or ordinary database queries. Tenant isolation must
survive a copied ciphertext row, and a leaked lease must have a short lifetime
and narrow use.

## Decision

Every credential receives a random data-encryption key (DEK). Libsodium
secretbox encrypts the plaintext with the DEK and a random nonce. A key provider
wraps the DEK. The database stores only `ciphertext`, `dek_wrapped`, `nonce`,
scopes, rotation metadata, and expiry.

Wrapping is bound to the account id. The local provider derives an account
wrapping key from the local KEK and the context string
`kiln:vault:v1:account:<account-id>`. A wrapped DEK copied to a different account
does not open. Asset ownership is checked through asset → venture → account
before credentials or leases are created.

## KEK locations

- Local development: `.kiln/keys/kek.key`, or `KILN_KEYFILE`, mode `0600`.
  This path is generated on first use and is forbidden when `NODE_ENV=production`.
- Tests: an isolated ignored key file selected by the package test config.
- Production target: a non-exportable KMS key selected by `KMS_KEY_ID` and the
  deployment region. Workloads receive decrypt permission through workload
  identity, not a static KMS credential in `.env`.

The KMS key-provider implementation is not present yet. Production startup must
remain blocked rather than fall back to the local key file.

## Decryption boundary

The package export surface does not expose a plaintext `open` function.
`withCredential` is the only public plaintext boundary. It validates an opaque
lease and supplies plaintext to a short-lived callback intended to sign one
egress request. The callback must not return, log, persist, or prompt with the
secret.

A lease:

1. proves credential ownership by account;
2. validates provider, asset/connection health, credential expiry, requested
   scopes, optional run ownership, tool id, and purpose;
3. is capped at 300 seconds;
4. is persisted in `credential_leases` under a random UUID; and
5. is revalidated at use time.

Lease revocation expires the row rather than deleting its audit record. Rotation
writes verified replacement ciphertext and expires outstanding leases in one
database transaction.

## Customer-initiated revocation

The intended UI action marks the connection revoked, expires active leases,
revokes the provider token where supported, and records an audit event. Current
code already refuses a lease when the latest connection is `expired` or
`revoked`, and supports individual lease revocation. A credential-level
`revoked_at` column, provider revocation calls, and the customer endpoint are
still required before live connectors.

## Audit and remaining controls

Lease rows record credential, run, tool, purpose, scopes, and expiry; structured
logs record the lease id and asset, never the credential id plus secret. A CI
rule must still enforce that `credentials.ciphertext` is selected only inside
`packages/vault`. JavaScript cannot guarantee memory zeroisation, so the
callback lifetime and worker isolation are the practical boundary.
