# Handover runbook

## Purpose

Transfer a venture from managed or delegated operation to customer control
without losing sales, renewal access, data, or an audit trail. Handover is a
workflow, not a ZIP export.

The present repository implements the prompt-1 custody boundary: customer-key
registration, a manifest assembled from the real asset inventory, a durable
`HandoverPacket` artifact, and a recipient-only encrypted break-glass envelope.
The provider files under `packages/connectors/*/handover.ts` define the concrete
transfer and verification steps. They do not yet call live provider APIs.
Operators must not describe the current UI as one-click live transfer until
every provider step below has a tested live adapter.

## Customer recovery key

The account owner generates an X25519 keypair on a customer-controlled machine:

```sh
openssl genpkey -algorithm X25519 -out kiln-break-glass-private.pem
openssl pkey -in kiln-break-glass-private.pem -pubout -out kiln-break-glass-public.pem
```

Register only `kiln-break-glass-public.pem` on the always-visible Handover page
or with `PUT /api/handover/key`. The API rejects private-key PEMs and non-X25519
keys. KILN stores the normalised public key, its SHA-256 SPKI fingerprint, the
algorithm, and registration time. Audit events contain the fingerprint, never
key material. Store the private file offline and test its backup; KILN cannot
recover it.

Rotating the public key affects new packets only. Retain the old private key
until every packet encrypted to its fingerprint has expired or been replaced.

## Packet assembly and encryption

`POST /api/handover` is owner-only, account-scoped, and idempotent. In one
transaction it:

1. locks the venture and loads its actual assets, latest artifacts, orders, and
   metrics through row-level security;
2. asks the provider handover adapters for one verified transfer plan per asset;
3. writes an immutable `handover_packet` artifact with the five-business-day
   target and every disclosed quality override;
4. builds the recovery export in memory and encrypts it to the registered
   customer public key; and
5. stores only the encrypted envelope, ciphertext checksum, key fingerprint,
   storage pointer, and a secret-free audit event.

The envelope uses ephemeral X25519 key agreement, HKDF-SHA-256, and AES-256-GCM
with a fresh 32-byte salt and 96-bit IV. Version, algorithm, recipient
fingerprint, and creation time are authenticated as additional data. The
ephemeral private key never leaves its short-lived crypto object; the shared
secret, AES-key, and plaintext buffers are cleared before the encryptor returns.

The envelope format supports recipient-only recovery material such as a domain
transfer code. In prompt 1, the web command deliberately includes none: the web
process may never decrypt vault credentials. Live provider adapters will issue
or resolve that material inside the tool boundary and pass it directly to the
encryptor before prompt-5 storage and delivery. Tests use a canary recovery
secret and assert that it appears after customer-side decryption but nowhere in
the persisted envelope.

## Preconditions

- Confirm the requester is an account owner using a fresh authentication step.
- Record the venture, requested effective time, destination legal entity,
  destination contacts, and reason.
- Freeze destructive changes and new long-lived commitments for the transfer
  window. Mirror ingestion and ordinary sales continue unless a provider
  requires maintenance.
- Resolve unpaid external spend and disclose renewal dates and transfer locks.
- Generate the handover manifest from the actual asset inventory. Do not rely
  on the playbook template alone.
- Create an immutable pre-transfer snapshot and customer data export.

## Manifest

For each asset record provider, external id, ownership mode, legal owner,
renewal/billing owner, current administrators, destination owner, transfer
mechanism, prerequisites, status, evidence, rollback option, and residual KILN
access. Include domains/DNS, storefront and catalogue, payment accounts, email,
analytics, pixels, booking, repositories/deployments, supplier accounts, brand
assets, policies, raw exports, and active authorisations.

Secrets are never placed in the manifest. A provider that cannot transfer a
credential must reissue it directly to the customer.

## Execution order

1. **Customer identity and destination accounts.** Complete provider KYC and
   create the customer's organisation/team before moving dependencies.
2. **Export and recovery material.** Deliver signed exports and verify the
   customer can decrypt the latest break-glass packet.
3. **Payments.** Move account ownership or complete the approved connected
   account flow. Verify payout bank, tax identity, statement descriptor,
   webhook destinations, and one sandbox/test transaction.
4. **Storefront/booking.** Invite the destination owner, transfer billing, and
   verify orders or bookings remain available.
5. **Domain and DNS.** Reduce TTL in advance, unlock only at the transfer window,
   transfer registrant/control, and verify web, checkout, email, and certificate
   records after propagation.
6. **Email and communications.** Transfer sender/domain control, rotate API
   keys, preserve consent/suppression records, and send a controlled test.
7. **Deployments, repositories, analytics, and suppliers.** Transfer teams and
   billing, then rotate integrations one at a time.
8. **Credential revocation.** Revoke KILN tokens and active leases only after
   destination verification. Expire standing spend/publish authorisations.

Every provider step writes an audit event with operator, timestamp, result, and
evidence pointer. Never include a secret in the event.

## Verification

The customer signs off that they can:

- log in as owner with recovery and MFA configured;
- renew the domain and change DNS;
- receive payments/payouts and issue a test refund;
- fulfil an order or booking;
- deploy and roll back the customer surface;
- send authenticated email;
- access analytics and exports; and
- identify all recurring provider charges.

KILN then verifies no credential lease remains usable and records the final
ownership mode as `transferred`.

## Failure and rollback

Stop at the failed asset; do not revoke the last working credential. If the
destination cannot operate an already transferred dependency, restore the prior
administrator or DNS state when the provider supports it. Record compensating
events instead of editing history. Escalate payment, domain, or identity lockout
immediately; those failures can stop the business.

## Emergency/KILN unavailable

The customer uses its private break-glass key to decrypt the latest escrow
packet and follows the provider recovery contacts in the manifest. KILN stores
only the customer's public key and the recipient-only envelope. The local
customer-side decrypt helper is `@kiln/connectors/handover/decrypt`; it verifies
the recipient fingerprint and AES-GCM tag before parsing the packet. Scheduled
object-storage delivery, long-lived signed URLs, email delivery, and lifecycle
testing remain prompt-5 work and must ship before managed custody is offered
live.
