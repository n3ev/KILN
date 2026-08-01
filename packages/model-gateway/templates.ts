import { createRng, type Rng } from "./rng.js";

/**
 * The template library behind the mock provider.
 *
 * When a fixture misses, the mock synthesises a response from the expected Zod
 * schema. Schema-shaped noise ("string1", "string2") would satisfy the types and
 * make every screen in the Run Theatre useless, so field names are matched
 * against these generators to produce text that reads like a real answer.
 *
 * The copy here is deliberately plain. It must pass the slop linter — a mock
 * that generates banned phrases would make every offline run fail its own
 * quality gates, which is a confusing way to discover your fixtures are stale.
 */

const MATERIALS = ["stoneware", "brass", "oiled ash", "linen", "recycled aluminium", "cork", "porcelain", "waxed canvas"];
const PLACES = ["Sheffield", "Leeds", "Porto", "Ghent", "Tallinn", "Bristol", "Aarhus", "Lisbon"];
const BUYERS = [
  "a nurse on rotating shifts who reads before bed",
  "a freelance designer billing four retainer clients",
  "a new parent working from a one-bedroom flat",
  "a cyclist commuting eleven miles each way",
  "a teacher who marks at the kitchen table",
];
const OBJECTIONS = [
  "The price is higher than the supermarket version.",
  "Delivery takes nine days and that is too long.",
  "It is not obvious this fits my existing setup.",
  "I have been disappointed by a similar product before.",
];
const CHANNELS = ["search", "instagram", "local directories", "craft markets", "email", "word of mouth"];

/**
 * Cadence.
 *
 * The slop linter blocks three consecutive sentences whose word counts sit
 * within 10% of each other, and it only considers sentences of five words or
 * more. The previous generator satisfied that by accident: it cycled one pool
 * of similar, long sentences, and the lengths happened not to line up. That
 * made every paragraph expensive — long enough to push two agents over their
 * context budget on the golden run — and shortening the pool moved the problem
 * rather than fixing it, because a shorter pool repeats sooner and repetition
 * is what the rule is looking for.
 *
 * So the variation is structural. Sentences live in three disjoint length
 * bands, and a paragraph walks a cadence that never takes three in a row from
 * one band. Any window of three therefore spans at least two bands, and the
 * bands are far enough apart that the ratio can never fall inside the
 * tolerance: 8 to 11 words is 37%, 16 to 20 is 25%. The rule cannot fire, at
 * any length, for any seed — and the paragraph can be much shorter, because it
 * no longer needs bulk to stay irregular.
 *
 * Substitutions are single tokens on purpose. A two-word material would change
 * a sentence's length and take it out of its band, so the bands are asserted
 * against the linter's own word counter in tests/contracts/mock-cadence.test.ts.
 */

/** Single-token substitutions, so a sentence's word count never moves. */
const UNIT_MATERIALS = ["stoneware", "brass", "linen", "cork", "porcelain", "ash", "aluminium", "canvas"];
const UNIT_TRADES = ["ceramicist", "bookbinder", "framer", "tailor", "welder", "upholsterer"];

type Band = "short" | "medium" | "long";

/** 5–8 words. Above the linter's five-word floor, so these still count. */
const SHORT_LINES: readonly ((rng: Rng) => string)[] = [
  (r) => `It weighs ${r.int(90, 1400)}g and ships flat.`,
  (r) => `The ${r.pick(UNIT_MATERIALS)} version costs a little more.`,
  () => `Every batch is checked twice.`,
  (r) => `Stock moves in about ${r.int(2, 9)} weeks.`,
  () => `We photograph the batch we ship.`,
  (r) => `Returns sit near ${r.int(2, 9)} percent.`,
  (r) => `The ${r.pick(UNIT_TRADES)} finishes each piece by hand.`,
  (r) => `Dispatch runs ${r.int(2, 14)} working days.`,
  () => `Nothing in this range is drop-shipped.`,
  () => `The colour shifts between batches.`,
];

/** 11–16 words. */
const MEDIUM_LINES: readonly ((rng: Rng) => string)[] = [
  (r) => `The first batch ran to ${r.int(40, 400)} units and sold out in ${r.int(3, 20)} weeks.`,
  (r) => `It costs ${r.int(9, 140)} to make and sells for roughly three times that.`,
  (r) => `Lead time from order to doorstep is ${r.int(2, 14)} days across ${r.pick(PLACES)} and nearby.`,
  () => `Two things matter to that buyer: how long it lasts and whether it repairs.`,
  (r) => `The ${r.pick(UNIT_MATERIALS)} is cut in ${r.pick(PLACES)} and assembled in the same workshop.`,
  () => `Most buyers order one, keep it for years, then order a second.`,
  () => `We quote the real dispatch window before checkout rather than after it.`,
  (r) => `The wear shows on the ${r.pick(UNIT_MATERIALS)} first, which is why we photograph it.`,
  () => `Sizing is the point buyers raise first, so it leads the description.`,
  (r) => `A repair costs ${r.int(8, 60)} and takes ${r.int(2, 9)} days, which beats replacing it.`,
];

/** 20–26 words. */
const LONG_LINES: readonly ((rng: Rng) => string)[] = [
  () => `The buyer is usually someone who reads the dimensions before the description, and that shapes almost every decision about how this is built.`,
  (r) => `Made from ${r.pick(UNIT_MATERIALS)} in ${r.pick(PLACES)}, finished by a ${r.pick(UNIT_TRADES)} who has worked the same bench for ${r.int(4, 30)} years, and sold direct rather than through a shop.`,
  (r) => `Returns run at about ${r.int(2, 9)} percent and almost all of them are sizing, so the size guide carries the measurements rather than a chart of letters.`,
  (r) => `The unit cost sits at ${r.int(9, 140)} before shipping, which leaves enough margin to replace a damaged order without arguing about who was at fault.`,
  (r) => `Most of the ${r.pick(UNIT_MATERIALS)} arrives in ${r.int(10, 90)} kilo batches from one supplier in ${r.pick(PLACES)}, and a second supplier is held in reserve for the same specification.`,
  (r) => `Customers who buy twice tend to buy the same thing again rather than trading up, which is why the range stays at ${r.int(4, 20)} pieces.`,
  () => `The finish is applied by hand and no two pieces match exactly, which is stated on the product page instead of being discovered on delivery.`,
  () => `Orders placed before noon leave the same day, and anything after that waits until the next working day because the courier collects once.`,
];

const BANDS: Record<Band, readonly ((rng: Rng) => string)[]> = {
  short: SHORT_LINES,
  medium: MEDIUM_LINES,
  long: LONG_LINES,
};

/**
 * Every cadence is checked in tests/contracts/mock-cadence.test.ts for the one
 * property that matters: no three consecutive entries — counting the wrap,
 * since long paragraphs repeat the pattern — come from the same band.
 */
const CADENCES: readonly (readonly Band[])[] = [
  ["long", "short", "medium"],
  ["medium", "short", "long", "short"],
  ["long", "medium", "short", "medium"],
  ["short", "medium", "long", "medium", "short", "long"],
];

export const SENTENCE_BANDS = { SHORT_LINES, MEDIUM_LINES, LONG_LINES, CADENCES } as const;

/**
 * Builds a paragraph of at least `minWords` words and `minChars` characters,
 * stopping before it passes `maxChars`.
 *
 * All three bounds are honoured in one pass. Generating a short paragraph and
 * then concatenating a second one to reach a schema's `minLength` would join
 * two independent cadences at an unchecked boundary, which is the one place
 * three similar sentences could still meet. Stopping at `maxChars` matters for
 * the opposite reason: overshooting and letting the caller slice the result
 * leaves a half-finished sentence, and that is what the customer reads.
 */
function paragraph(rng: Rng, minWords: number, minChars = 0, maxChars = Number.POSITIVE_INFINITY): string {
  const cadence = rng.pick([...CADENCES]);
  // Each band is walked from a random offset and stepped forward, so a
  // paragraph exhausts the band before it repeats a sentence. The old
  // generator re-used the same five sentences every time it needed length,
  // which put verbatim duplicates into every product description.
  const cursors: Record<Band, number> = {
    short: rng.int(0, SHORT_LINES.length - 1),
    medium: rng.int(0, MEDIUM_LINES.length - 1),
    long: rng.int(0, LONG_LINES.length - 1),
  };

  const parts: string[] = [];
  let words = 0;
  let chars = 0;
  for (let i = 0; words < minWords || chars < minChars; i++) {
    const band = cadence[i % cadence.length] ?? "medium";
    const pool = BANDS[band];
    const line = (pool[cursors[band] % pool.length] ?? pool[0])?.(rng) ?? "It works.";
    cursors[band]++;
    // One sentence always lands, even under an impossibly tight cap; the
    // caller's clamp is the backstop for that.
    if (parts.length > 0 && chars + line.length + 1 > maxChars) break;
    parts.push(line);
    words += (line.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
    chars += line.length + 1;
  }
  return parts.join(" ");
}

export interface FieldHint {
  readonly key: string;
  readonly path: readonly string[];
  readonly rng: Rng;
  readonly minLength?: number;
  readonly maxLength?: number;
}

type Generator = (h: FieldHint) => string;

/** Roughly six characters per word, spaces included. Used to fit a cap. */
const CHARS_PER_WORD = 7;

/**
 * Word target for a `*description*` field.
 *
 * A product or service description has a hard floor: CLAUDE.md §11.5 and
 * productDescriptionsGate both want 120+ words. But the same field name also
 * covers `shortDescription` (300 chars) and `seo.description` (160), which used
 * to be generated at 130 words and then chopped mid-sentence by the maxLength
 * clamp — so the linter, the gallery, and the customer all saw a fragment. A
 * declared cap is the field saying it is not that kind of description.
 */
function descriptionWords(h: FieldHint): number {
  const cap = h.maxLength ?? Number.POSITIVE_INFINITY;
  return cap < 130 * CHARS_PER_WORD ? Math.max(12, Math.floor(cap / CHARS_PER_WORD)) : 130;
}

/** Word target for prose fields with no length gate of their own. */
function proseWords(h: FieldHint, target: number): number {
  const cap = h.maxLength ?? Number.POSITIVE_INFINITY;
  return cap < target * CHARS_PER_WORD ? Math.max(8, Math.floor(cap / CHARS_PER_WORD)) : target;
}

const BRAND_HEXES = [
  "#1c1b19", "#2f2a25", "#4a443c", "#6b6257", "#8a7f70", "#a89a86",
  "#c4b7a2", "#e2dbcf", "#f4f0e8", "#7d3f2c", "#3f5545", "#2b4655",
];
const COLOUR_ROLE = /^(hex|primary|secondary|accent|accentText|background|border|surface|text|textMuted|positive|critical|warning|info|neutral|muted)$/i;

/** Field-name patterns, most specific first. */
const STRING_TEMPLATES: readonly { match: RegExp; gen: Generator }[] = [
  { match: /^oneLiner$|^headline$|^title$|^positioningStatement$/i, gen: (h) =>
      `${h.rng.pick(["Hand-thrown", "Repaired", "Made-to-order", "Small-batch"])} ${h.rng.pick(MATERIALS)} goods from ${h.rng.pick(PLACES)}` },
  { match: /description/i, gen: (h) =>
      paragraph(h.rng, descriptionWords(h), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
  { match: /body|narrative|memo|rationale|reasoning|interpretation|why|detail/i, gen: (h) =>
      paragraph(h.rng, proseWords(h, 22), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
  { match: /objection/i, gen: (h) => h.rng.pick(OBJECTIONS) },
  { match: /channel/i, gen: (h) => h.rng.pick(CHANNELS) },
  { match: /portrait|customer|icp|buyer/i, gen: (h) => h.rng.pick(BUYERS) },
  { match: /material|specification/i, gen: (h) => h.rng.pick(MATERIALS) },
  { match: /locality|city|area|region/i, gen: (h) => h.rng.pick(PLACES) },
  { match: /^name$|supplierName|brandName|chosenName/i, gen: (h) =>
      `${h.rng.pick(["Kiln", "Ledger", "Hollow", "Quarry", "Ember", "Thread", "Anvil"])}${h.rng.pick(["", " & Co", " Works", " Studio"])}` },
  { match: /handle|slug/i, gen: (h) => h.rng.pick(["stoneware-holder", "brass-stand", "ash-tray-small", "linen-wrap"]) },
  { match: /storageKey/i, gen: (h) =>
      `assets/mock/${Array.from({ length: 16 }, () => "0123456789abcdef"[h.rng.int(0, 15)] ?? "0").join("")}` },
  { match: /sku/i, gen: (h) => `SKU-${h.rng.int(1000, 9999)}` },
  { match: /email/i, gen: (h) => `hello@${h.rng.pick(["kilnworks", "emberstudio", "quarrygoods"])}.co` },
  { match: /url|link|href/i, gen: (h) => `https://${h.rng.pick(["example-supplier", "trade-directory", "review-site"])}.co/${h.rng.int(100, 999)}` },
  { match: /domain/i, gen: (h) => `${h.rng.pick(["kilnworks", "emberstudio", "quarrygoods"])}.${h.rng.pick(["com", "co", "shop"])}` },
  { match: /instruction|action|step|milestone|firstAction/i, gen: (h) =>
      `${h.rng.pick(["Email", "List", "Photograph", "Price", "Post"])} the ${h.rng.pick(["first ten units", "top three SKUs", "sample batch"])} by ${h.rng.pick(["Friday", "the end of week two"])}.` },
  { match: /quote|complaint/i, gen: (h) => h.rng.pick(OBJECTIONS) },
  { match: /statement|assumption|claim/i, gen: (h) =>
      `Buyers in this category replace the item every ${h.rng.int(6, 36)} months.` },
  // Brand and design-token fields. These fell through too, which is why the
  // committed design-gallery baseline renders a fallback sentence where a font
  // family belongs.
  { match: /^hex$|colou?r$/i, gen: (h) => h.rng.pick(BRAND_HEXES) },
  { match: /family|typeface|font/i, gen: (h) =>
      h.rng.pick(["Sohne", "GT Sectra", "Untitled Sans", "Lyon Text", "Founders Grotesk", "Signifier"]) },
  { match: /^pair$|pairing/i, gen: (h) => `${h.rng.pick(["Signifier", "Lyon Text", "GT Sectra"])} over ${h.rng.pick(["Söhne", "Untitled Sans"])}` },
  { match: /^platform$/i, gen: (h) => h.rng.pick(["instagram", "email", "pinterest", "tiktok"]) },
  { match: /^svg$/i, gen: () => `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="4"/></svg>` },
  { match: /^seed$|^id$|^hexSeed$/i, gen: (h) => Array.from({ length: 8 }, () => "0123456789abcdef"[h.rng.int(0, 15)] ?? "0").join("") },
  { match: /^palette$|lighting|composition|photographyStyle|artDirection/i, gen: (h) =>
      `${h.rng.pick(["Flat north light", "Single hard source", "Overcast daylight", "Raking side light"])} on ${h.rng.pick(["unfinished plaster", "raw timber", "mill-finish steel", "undyed linen"])}.` },
  { match: /^examples?$|^writes$|^avoids$|voiceExample|sampleLine/i, gen: (h) =>
      `${h.rng.pick(["The rest is 42mm across and sits flat.", "Dispatch is nine days, not next day.", "Each batch is fired once; the colour shifts a little.", "If it arrives wrong, we collect it and pay the postage."])}` },
  { match: /whichMeans|^meaning$|^attribute$|^term$/i, gen: (h) =>
      `${h.rng.pick(["Plain", "Exact", "Unhurried", "Durable"])} — ${h.rng.pick(["say the dimension before the adjective", "name the material, not the mood", "quote the wait honestly", "show the wear, not the studio"])}.` },
  // Strategy and validation fields. Before these existed, every one of them fell
  // through to FALLBACK_SENTENCES, which put "Synthetic fixture value produced
  // for this sandboxed run." straight into customer-facing artifact copy — and
  // the slop linter had no rule that could see it.
  { match: /excerpt|summary|note|basis|justification/i, gen: (h) =>
      paragraph(h.rng, proseWords(h, 15), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
  { match: /forWhom|competesIn/i, gen: (h) => h.rng.pick(BUYERS) },
  { match: /aspiresTo|primaryBet|positioning/i, gen: (h) =>
      `Win on ${h.rng.pick(["fit accuracy", "repair turnaround", "batch consistency", "delivery certainty"])} rather than on price.` },
  { match: /currentSolution/i, gen: (h) =>
      `They ${h.rng.pick(["improvise with a substitute", "buy the cheapest option and replace it", "order from overseas and wait"])} today.` },
  { match: /problem|situation|^theme$/i, gen: (h) =>
      `${h.rng.pick(["Sizing", "Delivery time", "Finish quality", "Restocking"])} is the point buyers raise first.` },
  { match: /response|mitigation|replaceWith|change/i, gen: (h) =>
      `${h.rng.pick(["State the dimension in the first line", "Quote a real dispatch window", "Photograph the actual batch", "Cap the range at three finishes"])}.` },
  { match: /risk|ifFalse|abandonIf|tradeoffAccepted|triggerEvent/i, gen: (h) =>
      `If ${h.rng.pick(["repeat orders stay under 15%", "returns pass 8%", "unit cost rises past the quoted ceiling"])}, the position does not hold.` },
  { match: /measurable|verifiableBy|testableBy|proofRequired|validation/i, gen: (h) =>
      `Measured by ${h.rng.pick(["repeat order rate", "return rate", "contribution margin", "time to first dispatch"])} over ${h.rng.int(4, 12)} weeks.` },
  // Leaf keys that packages/runtime/prose.ts feeds to the slop linter. Every one
  // of these is customer-facing, so none may fall through to FALLBACK_SENTENCES.
  { match: /^copy$|^text$|^blocks?$|^messages?$|^components?$|^pages?$/i, gen: (h) =>
      paragraph(h.rng, proseWords(h, 22), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
  { match: /^subject$/i, gen: (h) =>
      `${h.rng.pick(["Your order is packed", "The next batch opens Friday", "One question about your delivery", "A smaller size is back"])}` },
  { match: /^condition$|^wouldChangeIf$|^tradeoff$/i, gen: (h) =>
      `If ${h.rng.pick(["lead times pass three weeks", "the supplier misses a second batch", "returns cluster on one size"])}, this changes.` },
  { match: /returnsPolicy|^policies$|^policy$/i, gen: (h) =>
      `Return anything unused within ${h.rng.int(14, 60)} days and we pay the postage. Made-to-order pieces are exempt, and that is stated before checkout.` },
  { match: /digitalDeliverables|emailSequences|launchPosts|^services$|^products$/i, gen: (h) =>
      paragraph(h.rng, proseWords(h, 22), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
  { match: /^brief$|^revisedOneLiner$/i, gen: (h) =>
      `${h.rng.pick(["Hand-thrown", "Repaired", "Made-to-order", "Small-batch"])} ${h.rng.pick(MATERIALS)} goods from ${h.rng.pick(PLACES)}` },
  { match: /reason|locate|variable|label|revisitBy|workingName|tierName|^value$/i, gen: (h) =>
      paragraph(h.rng, proseWords(h, 12), h.minLength ?? 0, h.maxLength ?? Number.POSITIVE_INFINITY) },
];

/**
 * Exported so the slop linter can be held to recognising it. Mirrored in
 * packages/quality/dictionaries/fixture-filler.json; if the two drift,
 * tests/contracts/fixture-filler-parity.test.ts fails.
 */
export const FALLBACK_SENTENCES = [
  "Recorded during the offline build; no live source was consulted.",
  "Derived from the brief rather than from market data.",
  "Synthetic fixture value produced for this sandboxed run.",
];

export function synthString(hint: FieldHint): string {
  // Palette roles ("text", "background", "primary"…) collide with prose field
  // names, so they are resolved by position rather than by name.
  if (COLOUR_ROLE.test(hint.key) && hint.path.some((s) => /palette|colou?rs?|tokens|swatch/i.test(s))) {
    return hint.rng.pick(BRAND_HEXES);
  }
  // Array elements arrive with their index as the key ("0", "1", …). Matching on
  // that means every string inside every array misses all templates and falls
  // through to FALLBACK_SENTENCES, so match on the nearest named ancestor.
  const named = /^\d+$/.test(hint.key)
    ? [...hint.path].reverse().find((segment) => !/^\d+$/.test(segment)) ?? hint.key
    : hint.key;
  const template = STRING_TEMPLATES.find((t) => t.match.test(named));
  let value = template ? template.gen(hint) : hint.rng.pick(FALLBACK_SENTENCES);

  // A one-line template (a SKU, an email address) under a long `minLength` is
  // the only case left that needs padding. Append a whole paragraph rather than
  // sentence fragments, so the added text carries its own cadence.
  if (hint.minLength !== undefined && value.length < hint.minLength) {
    value = `${value} ${paragraph(hint.rng, 0, hint.minLength - value.length)}`;
  }
  if (hint.maxLength !== undefined && value.length > hint.maxLength) {
    // Backstop only — the generators fit the cap themselves. Prefer cutting at
    // a sentence end so an over-long value degrades to shorter copy rather than
    // to a fragment, but never below a declared minLength.
    const clipped = value.slice(0, hint.maxLength).trimEnd();
    const lastEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("."));
    const whole = lastEnd > 0 ? clipped.slice(0, lastEnd + 1) : clipped;
    value = whole.length >= (hint.minLength ?? 0) ? whole : clipped;
  }
  return value;
}

/** Plausible magnitudes by field name, so money is money and counts are counts. */
export function synthNumber(key: string, rng: Rng): number {
  if (/micros$/i.test(key)) return rng.int(2, 400) * 1_000_000;
  if (/cents$/i.test(key)) return rng.int(200, 40_000);
  if (/pct$|percent|rate$/i.test(key)) return Math.round(rng.float(1, 65) * 10) / 10;
  if (/^score$/i.test(key)) return rng.int(4, 5);
  if (/confidence/i.test(key)) return Math.round(rng.float(0.4, 0.95) * 100) / 100;
  if (/days$/i.test(key)) return rng.int(1, 21);
  if (/quantity|units|moq|count|volume/i.test(key)) return rng.int(10, 2000);
  if (/weight|grams/i.test(key)) return rng.int(50, 2500);
  if (/ratio/i.test(key)) return Math.round(rng.float(0.5, 4) * 100) / 100;
  return rng.int(1, 100);
}

export function templateRng(seed: string, path: readonly string[]): Rng {
  return createRng(`${seed}::${path.join(".")}`);
}
