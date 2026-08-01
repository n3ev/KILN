# Subprocessor register

Last reviewed: 2026-08-01

KILN's zero-key sandbox runs locally with embedded PostgreSQL and the mock model/connector adapters, so it sends no customer workload to an AI or connector vendor. Production subprocessors are configuration-gated. A deployment operator must publish the active subset, its deployment regions, and a privacy contact before accepting production customer data.

## Core and configuration-gated subprocessors

| Provider | Purpose | Data categories | Becomes active when |
| --- | --- | --- | --- |
| Supabase | Hosted PostgreSQL, authentication, object storage and realtime delivery | Account identity, tenant business records, artifacts and event notifications | Supabase/database credentials select the hosted adapters. The embedded default does not contact Supabase. |
| Fly.io | Web and worker compute/networking | Request metadata and the tenant data processed by each workload | KILN is deployed to Fly Machines. Local processes do not contact Fly.io. |
| Stripe | KILN subscription checkout, billing portal and webhook reconciliation | Account email, KILN account reference, plan, subscription and payment status | Stripe keys are configured. Payment card details are collected by Stripe and are not stored by KILN. |
| Moonshot AI (Kimi) | Model inference | Secret-scrubbed prompts, venture context and requested artifact schemas | `MODEL_PROVIDER=kimi` or Kimi appears in the configured fallback order with a key. |
| DeepSeek | Model inference | Secret-scrubbed prompts, venture context and requested artifact schemas | `MODEL_PROVIDER=deepseek` or DeepSeek appears in the configured fallback order with a key. |
| AWS | Non-exportable KMS key wrapping | Wrapped data-encryption keys and account-bound key context; not plaintext credentials | The production KMS key provider is selected and configured. The local key provider is forbidden in production. |
| Inngest | Durable hosted workflow dispatch | Job type, opaque resource identifiers and minimal retry metadata | Inngest keys select the hosted jobs adapter. PostgreSQL is the zero-key queue. |
| Resend | Transactional email delivery | Recipient address and the minimum notification or handover-delivery content | A live email adapter and Resend key are enabled. Current sandbox behavior is simulated. |

No hosted observability vendor is active in this prompt. OpenTelemetry uses the console exporter. If a deployment adds Sentry, Datadog, Honeycomb, a managed Redis service, managed object storage, or another telemetry/hosting vendor, that vendor must be added here before data is sent.

## Customer-directed external services

Shopify, Vercel, Cloudflare, Namecheap, Printful, and configured search or image services receive data only when the customer selects the associated playbook/tool and authorises the effect. Depending on the service and transaction, these vendors may be the customer's own processor or an independent controller rather than KILN's subprocessor. They can receive venture content, asset metadata, fulfilment details, public site content, or scoped provider API requests. Vault credentials are leased only inside the connector's egress boundary and never enter model prompts, logs, run events, or customer exports.

Generic `SEARCH_API_KEY` and `IMAGE_API_KEY` settings do not identify a legal entity. A production deployment must replace each generic setting with a named adapter and add that vendor, its data categories and region to this register before enabling it.

## Change control

- Review this register before enabling any new hosted adapter and at least every six months.
- Record the provider's legal entity, processing purpose, data location, retention controls, security terms and transfer mechanism in the deployment's vendor register.
- Give production customers advance notice of a new subprocessor according to their contract; the operating target is at least 30 days where the contract does not specify longer.
- Remove a provider from the active deployment before removing it from the published active list.
- Keep model routing, tool egress and credential leasing behind their existing interfaces so a provider can be disabled without rewriting product logic.

This file is an engineering register, not a substitute for the deployment operator's signed data-processing agreements or jurisdiction-specific legal review.
