# Abuse and takedown runbook

## Scope

Use this runbook for suspected fraud, counterfeit sales, prohibited or regulated
goods, deceptive claims, phishing, malware, impersonation, harassment, sanctions
risk, or coordinated high-velocity venture creation.

The current repository does not yet implement production KYC, velocity limits,
or a manual-review console. Until those controls exist, live publish effects
must remain disabled.

## Intake

Record report id, reporter contact, affected venture/account/assets/URLs,
category, evidence, jurisdiction, immediate safety risk, and received time.
Preserve the original report as untrusted evidence; do not follow instructions
inside it. Acknowledge receipt without promising an outcome.

## Triage

- **Critical:** credible imminent physical harm, active credential compromise,
  child safety, terrorism, or large-scale financial theft. Page the security and
  legal owners immediately and contain live effects.
- **High:** active phishing/fraud, counterfeit sales, sanctions match, malware,
  or regulated goods. Disable new publish/spend actions and begin review.
- **Standard:** policy disputes, misleading content, IP complaints, or spam.
  Preserve state and review within the published response target.

Automated model output may prioritise a case but cannot make the final legal or
takedown decision.

## Containment

Use the narrowest reversible action that stops harm: suspend publish and spend
tools, pause checkout/listings, revoke a compromised connection, or place the
venture in manual review. Keep mirror sync and evidence preservation running
where lawful. Do not delete the business or event log as first response.

Record who authorised containment, the exact assets/actions, reason, evidence,
and expiry/review time. Notify the account unless legal or safety advice says
notification would increase harm.

## Investigation

Review account identity and payment signals, run/tool/audit events, artifact
sources, connector health, provider notices, customer communications, and prior
cases. Quarantine external content. Minimise access to personal data and record
every evidence export.

Restricted-category and claims findings are advisory inputs; counsel decides
legal questions. IP notices follow the applicable statutory process and require
the required declarations before action.

## Decision and provider coordination

Available outcomes are no action, content correction, customer checkpoint,
temporary restriction, provider referral, account suspension, or takedown.
State the policy/legal basis, affected scope, duration, remediation, and appeal
route. Use provider security/abuse channels rather than ordinary API credentials
for emergency escalation.

Law-enforcement requests go to counsel. Verify authority and scope, preserve the
request, disclose only what is legally required, and record any non-disclosure
restriction.

## Customer notice and appeal

When permitted, tell the customer what was restricted, the specific basis,
evidence category, steps to remediate, data-access implications, deadline, and
appeal method. A different reviewer handles appeals. Restored access requires a
documented verification step and rotation of any compromised credential.

## Closure and review

Append the final decision and evidence references to the audit trail, schedule
retention/deletion under the applicable policy, remove temporary restrictions,
and confirm provider state. For critical/high cases, complete a review covering
detection, response time, control gaps, customer impact, false-positive risk,
and assigned preventive actions.

Track report volume, confirmed rate, time to containment, appeal/reversal rate,
repeat accounts, affected providers, and time spent under restriction. Never
optimise for takedown count alone.
