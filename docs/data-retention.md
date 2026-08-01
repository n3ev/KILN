# Data retention and deletion

Last reviewed: 2026-08-01

This policy describes the data KILN's current schema and account lifecycle code actually retain. It does not promise a background purge that the repository does not implement. A deployment operator may choose shorter retention, but must not exceed the ceilings below or extend them silently.

## Retention by data class

| Data class | Examples | Active-account retention | Deletion behavior |
| --- | --- | --- | --- |
| Identity and account | Account name, user email, role, auth UID, verification state | Account lifetime | Deleted in the owner-confirmed account transaction. The configured authentication provider must also remove its identity record. |
| Venture record | Briefs, domains, ownership state, customer-directed provider identifiers | Account lifetime, including archived ventures | Cascades from `accounts` through `ventures`. Customer-owned external provider accounts are not destroyed by a local data request. |
| Run and decision record | Runs, append-only events, phases, tasks, checkpoints, model traces, tool-call records, spend approvals | Account lifetime so replay and customer audit remain possible | Cascades through ventures and runs. No derived run state is retained separately as truth. |
| Customer artifacts | Strategy, content, brand assets, policies, sites, quality evidence | Account lifetime, including superseded versions | Artifact metadata and database-backed content cascade through ventures. A hosted object-store adapter must delete referenced objects as part of its deletion hook before launch. The current zero-key path stores no live objects externally. |
| Business mirror | Pseudonymous orders, item lines, metrics, daily rollups | Account lifetime | Cascades through ventures. KILN does not mirror card data or direct consumer identity. |
| Billing | Subscription references, credit ledger, cost ledger | Account lifetime and while needed to reconcile an active subscription | Local rows cascade from the account. Deletion is blocked while a live Stripe subscription can renew; the owner must cancel it in Billing first. Linked Stripe inbox events are then deleted explicitly. Stripe's independently required financial records follow Stripe's and the merchant's legal obligations. |
| Credentials | Encrypted credential bytes, wrapped keys, nonces, scope metadata | Until connector revocation, asset deletion, or account deletion | Credential rows and lease metadata cascade through assets. Plaintext is never stored. Customer exports never query these tables. Provider-side tokens must be revoked by the relevant connector lifecycle hook. |
| MCP access | Hashed bearer tokens and scope metadata | Until revocation, expiry, or account deletion | Cascades from the account. Token hashes and bearer values are excluded from exports. |
| Audit and abuse review | Account actions, mutation-limit records, review evidence and decisions | Account lifetime | Cascades from the account. There is no undisclosed legal-hold copy in the current implementation. |
| Handover escrow | Recipient public-key metadata and recipient-only encrypted packet | Account lifetime or until packet replacement | Cascades through ventures. Packet ciphertext, signed URLs and private keys are excluded from ordinary customer exports. KILN never possesses the customer's private key. |
| Durable operations | Jobs and workflow waiters | Until completion/expiry and operational housekeeping, never beyond account deletion | These tables intentionally have no tenant foreign key. The deletion transaction resolves tenant run, venture, asset, connection and credential IDs, then explicitly removes matching waiters and jobs before deleting the account. |
| Provider webhook inbox | Verified Stripe event payloads and webhook replay receipts | Only as long as needed for idempotency and reconciliation, never beyond linked account deletion | Account-linked Stripe inbox rows are detected from customer, subscription and KILN account references and removed explicitly. Venture-linked webhook receipts cascade through ventures. Unattributed security/replay records contain no KILN account link and require operator housekeeping. |
| Application telemetry | Redacted structured logs and console OpenTelemetry spans | Process/runtime retention in the zero-key build | Not stored in tenant database tables. A hosted telemetry backend is not enabled in this prompt; before enabling one, add it to the subprocessor register and configure its deletion/retention controls. |

## Customer export

An account owner can download an export from **Account → Data & privacy** without contacting an operator. `/api/account/export` produces a no-store JSON attachment with schema version, generation timestamp and SHA-256 response digest.

The export uses explicit SQL column allowlists and a second recursive scrub at serialization. It includes account and user data, venture briefs, runs and events, artifacts, asset descriptors, connection health, decisions, mirrored orders and metrics, billing ledgers, audit history, review history, and non-secret handover metadata.

It never selects or emits:

- credential rows, encrypted credential bytes, wrapped keys, nonces, or leases;
- MCP bearer tokens or token hashes;
- recipient-only packet envelopes, signed download URLs, or private keys;
- raw webhook storage pointers or infrastructure queue payloads; or
- nested fields or values that match credential and secret patterns.

Exports are owner-only, durably rate-limited per account and source IP, audited, served with `Cache-Control: private, no-store`, and never cached by KILN.

## Owner-confirmed deletion flow

The destructive endpoint is `DELETE /api/account`. It accepts JSON containing `confirmation`, which must exactly match the account name shown in the owner-only UI.

The flow is one database transaction:

1. authenticate an owner and apply the durable account/IP mutation limit;
2. acquire an account-scoped advisory lock;
3. re-check the same user still owns the same account inside the elevated transaction;
4. reject a mismatched account name or a still-renewing live Stripe subscription;
5. resolve all account venture, run, user, asset, connection, credential and linked Stripe-event identifiers;
6. explicitly delete `event_waiters`, matching `job_queue` entries, and linked `stripe_events` because those infrastructure tables do not have tenant foreign keys;
7. delete `accounts`; database foreign keys cascade through every tenant-owned table; and
8. return a one-time receipt with deletion timestamp and row counts, while clearing browser cache, cookies and storage.

There is no soft-deleted shadow account. Failed confirmation, privilege re-check, external-subscription precondition, orphan cleanup, or account deletion rolls back the whole transaction.

## Backups and external systems

PGlite's local zero-key mode has no application-managed backup copy. A hosted database deployment must configure backup expiry no longer than 30 days and restrict restores to disaster recovery. A deletion takes effect in the live database immediately; deleted rows may remain in encrypted immutable backups until those backups age out and must not be restored except for disaster recovery, after which deletion requests must be replayed.

Deleting KILN data does not delete customer-owned Shopify, domain, hosting, email, payment, or fulfilment accounts. Use Handover before deletion when access or provider exports are still needed. Live connector implementations must revoke KILN's provider credentials and remove KILN-controlled object-store data; those provider writes remain behind the connector lifecycle interfaces until their launch prompt.

## Verification

The integration suite seeds a second tenant plus credential, token, queue, waiter and Stripe-inbox sentinels. It proves the customer export omits secret material, a wrong name does not delete data, all target tenant rows and non-FK operational rows are removed on confirmation, and the unrelated tenant and unrelated infrastructure work remain intact.
