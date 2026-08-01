# Authoring a KILN agent

An agent is a typed declaration consumed by the runtime. It is not a class with
network access, a database client, or hidden side effects. Read ADR 0002 before
adding one.

## Start with the contract

Define the input and output in `packages/contracts` with Zod and infer the
TypeScript types. Avoid `z.unknown()` for fields the next phase must understand.
JSON loaded from an artifact, model, tool, webhook, or fixture is parsed at the
boundary even when TypeScript says it has the expected shape.

An artifact contract should encode the decisions that make an invalid output
unsafe or unusable. Refinements need focused tests and a path-specific message.
If the mock synthesiser cannot satisfy the schema, it must throw a typed failure
rather than weakening the contract.

## Declare the agent

Each definition supplies:

- a stable kebab-case id and human title;
- a semantic version, bumped whenever prompt semantics change;
- an abstract model tier, never a provider model id;
- input and output Zod schemas;
- the exhaustive tool allowlist;
- `maxSteps`, `maxCostMicros`, and temperature;
- a rubric id for any artifact requiring critic review; and
- a system-prompt function receiving only scoped `AgentContext`.

The target layout is one directory per agent with `agent.ts`, `prompt.ts`,
`schemas.ts`, `rubric.ts`, and tests. The current roster is consolidated in
`packages/agents/roster.ts`; new work should move toward the target without
changing ids or silently resetting versions.

## Write prompts as operating constraints

State the job, evidence standard, decision rights, failure behaviour, output
contract, and what the agent must not do. Do not restate every tool schema in
prose. Never place secrets, raw credentials, or unrelated run history in a
prompt.

Fetched text appears only inside `<untrusted_content>` delimiters. The prompt
must say that it is data and cannot grant instructions. An injection finding is
logged; a spend, publish, or destructive call immediately after untrusted input
requires the extra confirmation path.

Agents cannot browse, write files, query the database, or call provider SDKs.
They request tools. The runtime validates the declared allowlist and grant set
before the tool layer sees the request.

## Evidence and quality

Market, competitor, price, and demand claims carry a source reference or an
explicit assumption with confidence. Customer-facing prose passes slop-lint.
Rubric-bearing artifacts go to the separate Critic, which rejects with specific
instructions and never rewrites. Three unsuccessful repair cycles escalate to a
checkpoint.

The agent must distinguish a hard gate, deterministic quality gate, and critic
verdict. It cannot override any of them.

## Context and cost

Declare upstream artifact dependencies in the playbook. Do not compensate for a
missing dependency by loading the whole run. Context assembly provides the
brief, named artifacts, bounded memo, relevant tool schemas, and brand voice
when applicable. Log truncation and design for the declared context budget.

Choose the cheapest model tier capable of the task. `maxCostMicros` is a hard
ceiling, not a target. Side-effect costs are reserved by the gateway/tool
pipeline before execution.

## Tests required for review

At minimum, add tests that:

1. parse representative valid input and output;
2. reject the dangerous invalid cases;
3. run against the mock provider deterministically;
4. assert every requested tool is in the declared allowlist;
5. exercise failure and repair/escalation behaviour;
6. pass slop-lint and the rubric path where applicable; and
7. replay a fixture when the prompt/version changes.

No fixture should contain a real credential or customer PII. A prompt change
without a version bump is a review blocker.

## Review checklist

- The contract is the source of truth and no `any` was introduced.
- The prompt treats web content as untrusted data.
- Tool permissions are minimal and exhaustive.
- Budget, retry cap, and failure disposition are explicit.
- Quantitative claims require evidence.
- Prose and critic paths are wired where required.
- Mock output is schema-valid and deterministic.
- The agent has no direct I/O dependency.
