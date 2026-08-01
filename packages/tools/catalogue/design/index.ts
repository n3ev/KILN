import { DesignTokens } from "@kiln/contracts";
import { generateDesignTokens } from "@kiln/design-engine";
import { z } from "zod";
import { defineTool, type AnyTool, type ToolContext } from "../../core/define.js";
import { fakeId, seedFor } from "../_helpers.js";

/** Brand generation: tokens, marks, imagery, and the imagery quality gate. */

const tokensInput = z.object({
  seed: z.string().min(1),
  tone: z.enum(["premium", "playful", "technical", "crafted", "utilitarian", "warm"]).optional(),
  archetype: z.enum(["physical", "digital", "service"]).optional(),
  preferredHue: z.number().min(0).max(360).optional(),
  dark: z.boolean().optional(),
});

async function buildTokens(input: z.infer<typeof tokensInput>): Promise<{ tokens: z.infer<typeof DesignTokens> }> {
  return {
    tokens: generateDesignTokens({
      seed: input.seed,
      ...(input.tone ? { tone: input.tone } : {}),
      ...(input.archetype ? { archetype: input.archetype } : {}),
      palette: {
        ...(input.preferredHue !== undefined ? { preferredHue: input.preferredHue } : {}),
        ...(input.dark !== undefined ? { dark: input.dark } : {}),
      },
    }),
  };
}

export const tokensGenerate = defineTool({
  id: "tokens.generate",
  version: "1.0.0",
  title: "Generate a design token set",
  description:
    "Generates a complete, brand-specific token set: type pairing with licence metadata, an " +
    "OKLCH palette with verified contrast, a spacing rhythm, an edge personality, a motion " +
    "signature, and a layout archetype. Output is deterministic for a given seed, so the same " +
    "brand always renders identically and a replay produces byte-identical tokens. It refuses " +
    "purple-to-blue palettes by construction. Pass `tone` derived from the voice charter so " +
    "the typography does not contradict how the brand talks.",
  scopes: ["design:generate"],
  sideEffect: "none",
  input: tokensInput,
  output: z.object({ tokens: DesignTokens }),
  idempotent: true,
  timeoutMs: 10_000,
  // Pure local computation — the live and simulated paths are the same code.
  execute: buildTokens,
  simulate: buildTokens,
});

export const logoGenerate = defineTool({
  id: "logo.generate",
  version: "1.0.0",
  title: "Generate a logo mark",
  description:
    "Produces an SVG wordmark or monogram from the brand name and token set, with clear-space " +
    "and minimum-size rules. Output is vector, not raster, so it scales to signage and favicons " +
    "alike. It does not produce pictorial illustration marks; those come from image.generate " +
    "and then mark.vectorise. Keep the name under about 18 characters for a wordmark to work.",
  scopes: ["design:generate"],
  sideEffect: "none",
  input: z.object({
    name: z.string().min(1).max(40),
    kind: z.enum(["wordmark", "monogram", "combination"]).default("wordmark"),
    fontFamily: z.string().min(1),
    colour: z.string().min(4),
  }),
  output: z.object({
    svg: z.string().min(1),
    kind: z.string(),
    clearSpaceRatio: z.number(),
    minWidthPx: z.number().int(),
  }),
  idempotent: true,
  timeoutMs: 20_000,
  execute: renderMark,
  simulate: renderMark,
});

async function renderMark(
  input: { name: string; kind: "wordmark" | "monogram" | "combination"; fontFamily: string; colour: string },
): Promise<{ svg: string; kind: string; clearSpaceRatio: number; minWidthPx: number }> {
  const initials = input.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const text = input.kind === "monogram" ? initials : input.name;
  const width = Math.max(120, text.length * 26);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" role="img" aria-label="${text}">` +
    `<title>${text}</title>` +
    `<text x="0" y="46" font-family="${input.fontFamily}" font-size="44" font-weight="600" ` +
    `letter-spacing="-0.02em" fill="${input.colour}">${text}</text></svg>`;

  return { svg, kind: input.kind, clearSpaceRatio: 0.5, minWidthPx: 96 };
}

export const imageGenerate = defineTool({
  id: "image.generate",
  version: "1.0.0",
  title: "Generate an image",
  description:
    "Generates product or lifestyle imagery from a brief. ALWAYS pass the brand's visual " +
    "direction in `styleBrief` and its avoid-list in `negativePrompts` — without them a " +
    "product set comes back looking like eight different photographers shot it, which is the " +
    "single most obvious tell of a generated storefront. Output must be passed through " +
    "image.qualityCheck before use. It cannot render legible text in images; put text in the " +
    "page, not the picture.",
  scopes: ["design:generate"],
  sideEffect: "write",
  input: z.object({
    brief: z.string().min(10),
    styleBrief: z.string().min(10),
    aspectRatio: z.enum(["1:1", "4:5", "3:2", "16:9"]).default("4:5"),
    negativePrompts: z.array(z.string()).default([]),
    count: z.number().int().min(1).max(4).default(1),
  }),
  output: z.object({
    images: z.array(z.object({ storageKey: z.string(), width: z.number().int(), height: z.number().int(), seed: z.string() })),
  }),
  budgetCategory: "image",
  costEstimate: () => 40_000,
  idempotent: true,
  timeoutMs: 120_000,
  async execute() {
    throw new Error("image.generate live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "image.generate", input.brief);
    const [w, h] = { "1:1": [1024, 1024], "4:5": [1024, 1280], "3:2": [1536, 1024], "16:9": [1600, 900] }[
      input.aspectRatio
    ] ?? [1024, 1024];
    return {
      images: Array.from({ length: input.count }, () => ({
        storageKey: `simulated/images/${fakeId(rng, "img", 16)}.webp`,
        width: w ?? 1024,
        height: h ?? 1024,
        seed: String(rng.int(1, 1_000_000)),
      })),
    };
  },
});

export const imageQualityCheck = defineTool({
  id: "image.qualityCheck",
  version: "1.0.0",
  title: "Check generated image quality",
  description:
    "Screens a generated image for the failures that make a storefront look machine-made: " +
    "malformed text, anatomical errors such as extra fingers, wrong aspect ratio, visible " +
    "artefacts, and drift from the brand's visual direction. Returns pass/fail per check with " +
    "a reason. A failing image must be regenerated or dropped — it must never reach a product " +
    "page, and the pre-launch quality gate will block the run if one does.",
  scopes: ["design:generate"],
  sideEffect: "read",
  input: z.object({
    storageKey: z.string().min(1),
    expectedAspectRatio: z.string().optional(),
    styleBrief: z.string().optional(),
  }),
  output: z.object({
    passed: z.boolean(),
    checks: z.array(z.object({ check: z.string(), passed: z.boolean(), detail: z.string() })),
  }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("image.qualityCheck live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "image.qualityCheck", input.storageKey);
    // A small failure rate keeps the regeneration path genuinely exercised.
    const textOk = rng.bool(0.9);
    const anatomyOk = rng.bool(0.95);
    const checks = [
      { check: "no-malformed-text", passed: textOk, detail: textOk ? "no rendered text detected" : "garbled lettering on the label" },
      { check: "anatomy", passed: anatomyOk, detail: anatomyOk ? "no anatomical errors detected" : "hand has six fingers" },
      { check: "aspect-ratio", passed: true, detail: `matches ${input.expectedAspectRatio ?? "requested ratio"}` },
      { check: "style-coherence", passed: true, detail: "consistent with the brand visual direction" },
    ];
    return { passed: checks.every((c) => c.passed), checks };
  },
});

export const markVectorise = defineTool({
  id: "mark.vectorise",
  version: "1.0.0",
  title: "Vectorise a raster mark",
  description:
    "Traces a raster image into clean SVG paths for use as a logo. Works well on high-contrast " +
    "silhouettes and badly on photographs or gradients — if the source is a photo, the right " +
    "answer is a different mark, not a trace of this one. Returns path count so an over-complex " +
    "trace can be rejected before it reaches a favicon.",
  scopes: ["design:generate"],
  sideEffect: "none",
  input: z.object({ storageKey: z.string().min(1), threshold: z.number().min(0).max(1).default(0.5) }),
  output: z.object({ svg: z.string(), pathCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("mark.vectorise live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "mark.vectorise", input.storageKey);
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 56 L32 8 L56 56 Z" fill="currentColor"/></svg>`,
      pathCount: rng.int(1, 6),
    };
  },
});

export const mockupRender = defineTool({
  id: "mockup.render",
  version: "1.0.0",
  title: "Render a product mockup",
  description:
    "Composites a product design onto a physical template — a mug, a tee, a poster in a room — " +
    "for catalogue imagery before any stock exists. Use it for print-on-demand ranges where " +
    "there is no photograph to take yet. Mockups must be visually consistent with the brand's " +
    "visual direction, and must never be presented to the customer as photographs of real stock.",
  scopes: ["design:generate"],
  sideEffect: "write",
  input: z.object({
    artworkStorageKey: z.string().min(1),
    template: z.enum(["mug", "tee", "tote", "poster-framed", "candle", "box", "in-room"]),
    scene: z.string().optional(),
  }),
  output: z.object({ storageKey: z.string(), width: z.number().int(), height: z.number().int() }),
  budgetCategory: "image",
  costEstimate: () => 15_000,
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("mockup.render live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "mockup.render", input.template);
    return { storageKey: `simulated/mockups/${fakeId(rng, "mock", 14)}.webp`, width: 1200, height: 1500 };
  },
});

export const imageEdit = defineTool({
  id: "image.edit",
  version: "1.0.0",
  title: "Edit an image",
  description:
    "Applies a bounded edit to an existing image: background removal, extend, or a masked " +
    "inpaint. Prefer this over regenerating when only one element is wrong, because " +
    "regeneration loses the visual consistency the rest of the set depends on. The result " +
    "still has to pass image.qualityCheck.",
  scopes: ["design:generate"],
  sideEffect: "write",
  input: z.object({
    storageKey: z.string().min(1),
    operation: z.enum(["remove-background", "extend", "inpaint", "recolour"]),
    instruction: z.string().optional(),
  }),
  output: z.object({ storageKey: z.string() }),
  budgetCategory: "image",
  costEstimate: () => 20_000,
  idempotent: true,
  timeoutMs: 90_000,
  async execute() {
    throw new Error("image.edit live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { storageKey: `simulated/images/${fakeId(seedFor(ctx, "image.edit", input.storageKey), "edit", 14)}.webp` };
  },
});

export const imageUpscale = defineTool({
  id: "image.upscale",
  version: "1.0.0",
  title: "Upscale an image",
  description:
    "Increases resolution for print or high-DPI display. Upscaling amplifies existing defects " +
    "rather than fixing them, so run image.qualityCheck first and upscale only what already " +
    "passed. Factors above 4x rarely improve perceived quality.",
  scopes: ["design:generate"],
  sideEffect: "write",
  input: z.object({ storageKey: z.string().min(1), factor: z.number().int().min(2).max(4).default(2) }),
  output: z.object({ storageKey: z.string(), width: z.number().int(), height: z.number().int() }),
  budgetCategory: "image",
  costEstimate: () => 8_000,
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("image.upscale live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "image.upscale", input.storageKey);
    return {
      storageKey: `simulated/images/${fakeId(rng, "up", 14)}.webp`,
      width: 1024 * input.factor,
      height: 1280 * input.factor,
    };
  },
});

export const designTools: readonly AnyTool[] = [
  tokensGenerate,
  logoGenerate,
  markVectorise,
  imageGenerate,
  imageEdit,
  imageUpscale,
  imageQualityCheck,
  mockupRender,
];

export type { ToolContext };
