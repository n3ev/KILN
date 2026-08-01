import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoIn, seedFor, slugify } from "../_helpers.js";

/** Email domain authentication, lists, sequences, and social provisioning. */

export const emailDomainProvision = defineTool({
  id: "emailDomain.provision",
  version: "1.0.0",
  title: "Provision a sending domain",
  description:
    "Sets up a sending domain with SPF, DKIM, and DMARC records and returns the DNS records to " +
    "publish. All three must verify before launch \u2014 the pre-launch quality gate checks them, " +
    "because mail from an unauthenticated domain lands in spam and the customer concludes the " +
    "business does not work. Verification is not instant: records propagate on their TTL. Use a " +
    "subdomain such as mail.example.com so a deliverability problem cannot damage the root " +
    "domain's reputation.",
  scopes: ["comms:configure", "dns:write"],
  sideEffect: "write",
  input: z.object({ domain: z.string().min(3), subdomain: z.string().default("mail") }),
  output: z.object({
    sendingDomain: z.string(),
    records: z.array(z.object({ type: z.string(), name: z.string(), value: z.string() })),
    spf: z.boolean(), dkim: z.boolean(), dmarc: z.boolean(), verified: z.boolean(),
  }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("emailDomain.provision live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "emailDomain", input.domain);
    const sending = `${input.subdomain}.${input.domain}`;
    return {
      sendingDomain: sending,
      records: [
        { type: "TXT", name: sending, value: "v=spf1 include:simulated-esp.net ~all" },
        { type: "CNAME", name: `${fakeId(rng, "k", 6)}._domainkey.${sending}`, value: "dkim.simulated-esp.net" },
        { type: "TXT", name: `_dmarc.${sending}`, value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@" + input.domain },
      ],
      spf: true, dkim: true, dmarc: true, verified: true,
    };
  },
});

export const sequenceCreate = defineTool({
  id: "sequence.create",
  version: "1.0.0",
  title: "Create an email sequence",
  description:
    "Creates a triggered email sequence (welcome, abandoned cart, post-purchase, win-back). " +
    "Each message needs a goal and a delay; a five-email sequence where every message says " +
    "'just checking in' performs worse than one good message. Copy must have passed copy.lint " +
    "before it gets here. Sequences are created paused so nothing sends before the launch gate.",
  scopes: ["comms:configure"],
  sideEffect: "write",
  input: z.object({
    name: z.string().min(1),
    trigger: z.enum(["signup", "purchase", "abandoned-cart", "post-delivery", "inactivity", "manual"]),
    messages: z.array(z.object({ subject: z.string().min(1), bodyMarkdown: z.string().min(1), delayDays: z.number().int().nonnegative(), goal: z.string().min(1) })).min(1),
  }),
  output: z.object({ sequenceId: z.string(), messageIds: z.array(z.string()), status: z.literal("paused") }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("sequence.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "sequence.create", input.name);
    return { sequenceId: fakeId(rng, "seq"), messageIds: input.messages.map(() => fakeId(rng, "msg")), status: "paused" as const };
  },
});

export const emailListCreate = defineTool({
  id: "emailList.create",
  version: "1.0.0",
  title: "Create an email list",
  description:
    "Creates a subscriber list with a double opt-in setting. Double opt-in is the default and " +
    "should stay on: it costs subscribers and buys deliverability, and a list that lands in " +
    "spam is worth nothing regardless of size. Does not import contacts.",
  scopes: ["comms:configure"],
  sideEffect: "write",
  input: z.object({ name: z.string().min(1), doubleOptIn: z.boolean().default(true) }),
  output: z.object({ listId: z.string(), name: z.string(), doubleOptIn: z.boolean() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("emailList.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { listId: fakeId(seedFor(ctx, "emailList", input.name), "list"), name: input.name, doubleOptIn: input.doubleOptIn };
  },
});

export const broadcastSchedule = defineTool({
  id: "broadcast.schedule",
  version: "1.0.0",
  title: "Schedule a broadcast",
  description:
    "Schedules a one-off send to a list. This reaches real people at a real time and always " +
    "requires approval. Sending to a list that has not been warmed, or before the sending " +
    "domain verifies, damages deliverability for every future send \u2014 both are checked first.",
  scopes: ["comms:send"],
  sideEffect: "publish",
  input: z.object({ listId: z.string().min(1), subject: z.string().min(1), bodyMarkdown: z.string().min(1), sendAt: z.string() }),
  output: z.object({ broadcastId: z.string(), scheduledFor: z.string(), recipientEstimate: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("broadcast.schedule live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "broadcast", input.subject);
    return { broadcastId: fakeId(rng, "bc"), scheduledFor: input.sendAt, recipientEstimate: rng.int(0, 240) };
  },
});

export const socialProfileProvision = defineTool({
  id: "social.profileProvision",
  version: "1.0.0",
  title: "Provision a social profile",
  description:
    "Prepares a social profile: handle, bio, link, and avatar derived from the brand system. " +
    "Most platforms do not permit automated account creation, so this produces a ready-to-apply " +
    "profile pack and, where the platform allows it, applies the profile to an already-connected " +
    "account. It never posts.",
  scopes: ["comms:configure"],
  sideEffect: "write",
  input: z.object({
    platform: z.enum(["instagram", "tiktok", "x", "pinterest", "linkedin", "facebook"]),
    handle: z.string().min(1), bio: z.string().max(160), link: z.string().url(), avatarStorageKey: z.string().optional(),
  }),
  output: z.object({ platform: z.string(), handle: z.string(), applied: z.boolean(), manualStepsRequired: z.array(z.string()) }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("social.profileProvision live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return {
      platform: input.platform,
      handle: slugify(input.handle).replace(/-/g, ""),
      applied: false,
      manualStepsRequired: [`Create the ${input.platform} account and connect it, then re-run to apply the profile.`],
    };
  },
});

export const postSchedule = defineTool({
  id: "post.schedule",
  version: "1.0.0",
  title: "Schedule a social post",
  description:
    "Queues a post for a connected social account. Publishes publicly at the scheduled time and " +
    "requires approval. Copy must have passed copy.lint, and the brand's emoji policy applies \u2014 " +
    "emoji are blocked in body copy unless the voice charter enables them.",
  scopes: ["comms:send"],
  sideEffect: "publish",
  input: z.object({ platform: z.string().min(1), body: z.string().min(1), imageStorageKey: z.string().optional(), scheduledFor: z.string() }),
  output: z.object({ postId: z.string(), scheduledFor: z.string(), platform: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("post.schedule live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { postId: fakeId(seedFor(ctx, "post", input.body), "post"), scheduledFor: input.scheduledFor, platform: input.platform };
  },
});

export const commsTools: readonly AnyTool[] = [emailDomainProvision, emailListCreate, sequenceCreate, broadcastSchedule, socialProfileProvision, postSchedule];
