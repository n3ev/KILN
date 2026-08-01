# ADR 0003: Managed asset custody

- Status: Proposed; legal and accounting review required
- Date: 2026-08-01

## Context

In managed mode KILN may configure stores, domains, email, analytics, booking,
and supplier accounts for a customer. Technical ability to hold a credential is
not permission to own an account or act as the merchant. Provider terms, KYC,
tax, insolvency, and jurisdiction rules decide what custody is defensible.

No live managed provisioning may launch on this ADR alone. Counsel and an
accountant must approve the provider-by-provider model and the customer terms.

## Decision

KILN is the agent building and operating the venture's assets. It is not the
merchant of record for the venture's customer sales by default. KILN is the
merchant only for its own subscription and disclosed service charges. A future
merchant-of-record product requires a separate ADR, payments design, tax model,
and regulatory review.

The customer or its legal entity remains the beneficial owner of the venture.
KILN may be an organisation owner, technical administrator, or delegated agent
only where the provider contract permits it and a tested transfer path exists.

## Provider working positions

These are implementation assumptions to verify against the current agreements
before enabling a live adapter; they are not legal conclusions.

| Provider class | Working custody position | Required verification |
| --- | --- | --- |
| Shopify | Use the Partner/development-store and collaborator mechanisms, then transfer or administer the merchant's store. Do not assume indefinite agency ownership is permitted. | Current Partner terms, store-transfer rules, billing ownership, and merchant identity requirements. |
| Stripe | The venture merchant or connected account supplies its own beneficial-owner and bank information. KILN must not impersonate the merchant or pool unrelated merchant funds. | Connect/platform agreement, KYC allocation, chargeback liability, reserves, tax, and each launch country. |
| Domain registrars | Prefer the customer entity as registrant, with KILN as technical/admin delegate. Registrar agency ownership rules vary. | Registrar/reseller terms, registrant data rules, transfer lock, renewal, and insolvency access. |
| Cloudflare/Vercel | Use teams and scoped service tokens; preserve a customer-accessible ownership or transfer route. | Agency/team terms, project/domain transfer, and export capability. |
| Email and booking | Customer controls the domain and sender identity; KILN receives delegated configuration access. | Anti-spam obligations, sender verification, data processing terms, and account transfer. |
| Suppliers/POD | Orders are placed for the disclosed venture and under an approved spend authorisation. | Agency ordering, product liability, import duties, deposits, and refund rights. |

The owner of each live adapter must attach the reviewed agreement/version and a
dated go-live decision to the provider runbook. A vague claim that an API exists
is not custody approval.

## Customer disclosure and authorisation

Before provisioning, KILN records the ownership mode, the legal owner, KILN's
role, transfer constraints, recurring fees, cancellation effects, and any asset
that cannot be transferred cleanly. Standing authorisations are bounded by
purpose, amount, currency, and expiry.

Managed mode requires a tested handover manifest and a customer-held
break-glass public key. Delegated mode requires reconnect and revocation paths.
Transferred mode removes KILN access after verification.

## KYC and jurisdiction controls

Before any live publish or payment effect, the paying account and the venture's
beneficial owner must satisfy the applicable KYC process. The launch checklist
must identify entity, trading-name, consumer, privacy, tax/VAT/GST, product,
licensing, and sanctions obligations in every operating jurisdiction. Regulated
categories enter manual review.

The present repository has schemas and abstractions for ownership modes but does
not implement production KYC or provider custody workflows. Live managed mode
therefore remains blocked.
