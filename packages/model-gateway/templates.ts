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
const TRADES = ["ceramicist", "bike mechanic", "bookbinder", "framer", "furniture maker", "tailor"];
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

/** Sentences of varied length, so synthetic prose does not trip the linter. */
function paragraph(rng: Rng, minWords: number): string {
  const openers = [
    `Made from ${rng.pick(MATERIALS)} in ${rng.pick(PLACES)}.`,
    `Each one is finished by hand by a ${rng.pick(TRADES)}.`,
    `The first batch ran to ${rng.int(40, 400)} units.`,
    `It weighs ${rng.int(90, 1400)}g.`,
  ];
  const middles = [
    `The buyer is usually ${rng.pick(BUYERS)}, which shapes almost every decision about it.`,
    `Two things matter to that buyer: how long it lasts and whether it can be repaired rather than replaced.`,
    `It costs ${rng.int(9, 140)} to make and sells for roughly three times that, before shipping.`,
    `Returns run at about ${rng.int(2, 9)} percent, mostly sizing.`,
    `Lead time from order to doorstep is ${rng.int(2, 14)} days.`,
  ];
  const closers = [`That is the whole of it.`, `Nothing else about it is unusual.`, `It works.`];

  const parts = [rng.pick(openers)];
  let words = parts[0]?.split(/\s+/).length ?? 0;
  let middleIndex = rng.int(0, middles.length - 1);
  while (words < minWords) {
    const next = middles[middleIndex % middles.length] ?? middles[0] ?? "It works.";
    parts.push(next);
    words += next.split(/\s+/).length;
    middleIndex++;
  }
  parts.push(rng.pick(closers));
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
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 130, 130)) },
  { match: /body|narrative|memo|rationale|reasoning|interpretation|why|detail/i, gen: (h) =>
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 40, 40)) },
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
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 30, 30)) },
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
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 40, 40)) },
  { match: /^subject$/i, gen: (h) =>
      `${h.rng.pick(["Your order is packed", "The next batch opens Friday", "One question about your delivery", "A smaller size is back"])}` },
  { match: /^condition$|^wouldChangeIf$|^tradeoff$/i, gen: (h) =>
      `If ${h.rng.pick(["lead times pass three weeks", "the supplier misses a second batch", "returns cluster on one size"])}, this changes.` },
  { match: /returnsPolicy|^policies$|^policy$/i, gen: (h) =>
      `Return anything unused within ${h.rng.int(14, 60)} days and we pay the postage. Made-to-order pieces are exempt, and that is stated before checkout.` },
  { match: /digitalDeliverables|emailSequences|launchPosts|^services$|^products$/i, gen: (h) =>
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 40, 40)) },
  { match: /^brief$|^revisedOneLiner$/i, gen: (h) =>
      `${h.rng.pick(["Hand-thrown", "Repaired", "Made-to-order", "Small-batch"])} ${h.rng.pick(MATERIALS)} goods from ${h.rng.pick(PLACES)}` },
  { match: /reason|locate|variable|label|revisitBy|workingName|tierName|^value$/i, gen: (h) =>
      paragraph(h.rng, Math.max(h.minLength ? h.minLength / 5 : 24, 24)) },
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

  if (hint.minLength !== undefined && value.length < hint.minLength) {
    while (value.length < hint.minLength) value += ` ${paragraph(hint.rng, 20)}`;
  }
  if (hint.maxLength !== undefined && value.length > hint.maxLength) {
    value = value.slice(0, hint.maxLength).trimEnd();
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
