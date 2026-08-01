import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoIn, seedFor, slugify } from "../_helpers.js";

/** Scheduling for the local-service archetype. */

export const bookingProvision = defineTool({
  id: "booking.provision",
  version: "1.0.0",
  title: "Provision a booking account",
  description:
    "Sets up a scheduling account and returns its public booking URL. Uses the Cal.com adapter " +
    "by default behind a generic scheduling interface, so a different provider can be swapped " +
    "in without touching the service menu. Does not set availability or publish services \u2014 " +
    "those are availability.set and serviceMenu.publish.",
  scopes: ["booking:configure"],
  sideEffect: "write",
  input: z.object({ businessName: z.string().min(1), timezone: z.string().min(3), provider: z.enum(["cal-com", "generic"]).default("cal-com") }),
  output: z.object({ accountId: z.string(), bookingUrl: z.string().url(), provider: z.string() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("booking.provision live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "booking.provision", input.businessName);
    const handle = slugify(input.businessName);
    return { accountId: fakeId(rng, "cal"), bookingUrl: `https://cal.simulated.co/${handle}`, provider: input.provider };
  },
});

export const serviceMenuPublish = defineTool({
  id: "serviceMenu.publish",
  version: "1.0.0",
  title: "Publish the service menu",
  description:
    "Publishes bookable services with duration and price. Durations must include travel and " +
    "setup for on-site work, or the calendar overbooks and the business fails its first week. " +
    "Quote-only services appear without a price and route to the quote-request flow instead of " +
    "taking a booking.",
  scopes: ["booking:configure"],
  sideEffect: "write",
  input: z.object({
    accountId: z.string().min(1),
    services: z.array(z.object({
      title: z.string().min(1), description: z.string().min(1), durationMinutes: z.number().int().positive(),
      priceMicros: z.number().int().nonnegative(), requiresQuote: z.boolean().default(false),
    })).min(1),
  }),
  output: z.object({ published: z.number().int(), serviceIds: z.array(z.string()) }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("serviceMenu.publish live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "serviceMenu", input.accountId);
    return { published: input.services.length, serviceIds: input.services.map(() => fakeId(rng, "svc")) };
  },
});

export const availabilitySet = defineTool({
  id: "availability.set",
  version: "1.0.0",
  title: "Set availability",
  description:
    "Sets weekly working hours and buffers. Leave a buffer between on-site jobs \u2014 back-to-back " +
    "bookings across a service area produce late arrivals, which is the most common early " +
    "complaint for a mobile service. Times are in the account's timezone.",
  scopes: ["booking:configure"],
  sideEffect: "write",
  input: z.object({
    accountId: z.string().min(1),
    weekly: z.array(z.object({ day: z.enum(["mon","tue","wed","thu","fri","sat","sun"]), start: z.string(), end: z.string() })).min(1),
    bufferMinutes: z.number().int().min(0).max(180).default(30),
  }),
  output: z.object({ daysConfigured: z.number().int(), bufferMinutes: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("availability.set live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { daysConfigured: input.weekly.length, bufferMinutes: input.bufferMinutes };
  },
});

export const leadRoute = defineTool({
  id: "lead.route",
  version: "1.0.0",
  title: "Route inbound leads",
  description:
    "Routes quote requests and enquiries to email and SMS so they are answered fast. Response " +
    "time is the main thing a local service competes on \u2014 an enquiry answered in ten minutes " +
    "converts far better than one answered the next day. SMS requires a verified number.",
  scopes: ["booking:configure", "comms:configure"],
  sideEffect: "write",
  input: z.object({ email: z.string().email(), sms: z.string().optional(), businessHoursOnly: z.boolean().default(false) }),
  output: z.object({ routes: z.array(z.string()), smsVerified: z.boolean() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("lead.route live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { routes: input.sms ? ["email", "sms"] : ["email"], smsVerified: Boolean(input.sms) };
  },
});

export const quoteRequestConfigure = defineTool({
  id: "quoteRequest.configure",
  version: "1.0.0",
  title: "Configure the quote-request flow",
  description:
    "Builds the form that captures a quote request for services that cannot be priced upfront. " +
    "Ask only what is needed to quote \u2014 every extra field costs completions. Photograph upload " +
    "is usually worth one field for repair and trade work.",
  scopes: ["booking:configure"],
  sideEffect: "write",
  input: z.object({
    fields: z.array(z.object({ name: z.string().min(1), label: z.string().min(1), type: z.enum(["text","textarea","select","photo","postcode"]), required: z.boolean().default(true) })).min(1),
    routeToEmail: z.string().email(),
  }),
  output: z.object({ formId: z.string(), fieldCount: z.number().int(), embedUrl: z.string().url() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("quoteRequest.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "quoteRequest", input.routeToEmail);
    const id = fakeId(rng, "form");
    return { formId: id, fieldCount: input.fields.length, embedUrl: `https://forms.simulated.co/${slugify(id)}` };
  },
});

export const bookingPageBrand = defineTool({
  id: "bookingPage.brand",
  version: "1.0.0",
  title: "Brand the booking page",
  description:
    "Applies the brand's design tokens to the hosted booking page so it does not look like a " +
    "generic scheduling tool bolted onto a branded site. Accepts the token set's CSS variables " +
    "directly. Some providers restrict which properties can be overridden; unsupported ones are " +
    "reported rather than silently dropped.",
  scopes: ["booking:configure", "design:generate"],
  sideEffect: "write",
  input: z.object({ accountId: z.string().min(1), cssVariables: z.record(z.string(), z.string()), logoSvg: z.string().optional() }),
  output: z.object({ applied: z.array(z.string()), unsupported: z.array(z.string()) }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("bookingPage.brand live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    const keys = Object.keys(input.cssVariables);
    const unsupported = keys.filter((k) => k.startsWith("--motion") || k.startsWith("--elevation"));
    return { applied: keys.filter((k) => !unsupported.includes(k)), unsupported };
  },
});

export const bookingTools: readonly AnyTool[] = [bookingProvision, serviceMenuPublish, availabilitySet, bookingPageBrand, leadRoute, quoteRequestConfigure];
