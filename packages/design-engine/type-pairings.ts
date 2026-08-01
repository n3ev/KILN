import type { TypePairing } from "@kiln/contracts";

/**
 * The type-pairing catalogue — CLAUDE.md §3.4 requires at least 24 real
 * pairings with licensing metadata.
 *
 * Licensing is carried here rather than looked up later because the handover
 * packet has to ship a fonts folder with proof of licence, and discovering at
 * handover time that a brand was built on a face nobody can legally use is a
 * genuinely expensive mistake. Every entry below is an open licence (OFL or
 * Apache) so a customer can take the brand with them without buying anything.
 */

const ofl = (
  family: string,
  source: "google" | "fontshare" | "bunny",
  weights: number[],
  fallbacks: string[],
) =>
  ({
    family,
    source,
    licence: "ofl" as const,
    weights,
    italic: false,
    fallbacks,
  });

const SERIF_FALLBACK = ["Georgia", "Times New Roman", "serif"];
const SANS_FALLBACK = ["Helvetica Neue", "Arial", "sans-serif"];
const MONO_FALLBACK = ["SFMono-Regular", "Menlo", "monospace"];

export const TYPE_PAIRINGS: readonly TypePairing[] = [
  // ── editorial-serif ────────────────────────────────────────────────────────
  {
    id: "fraunces-inter",
    display: ofl("Fraunces", "google", [400, 600, 900], SERIF_FALLBACK),
    text: ofl("Inter", "google", [400, 500, 600], SANS_FALLBACK),
    character: "editorial-serif",
    displayScale: 3.2,
  },
  {
    id: "playfair-source-sans",
    display: ofl("Playfair Display", "google", [400, 700, 900], SERIF_FALLBACK),
    text: ofl("Source Sans 3", "google", [400, 600], SANS_FALLBACK),
    character: "editorial-serif",
    displayScale: 3.6,
  },
  {
    id: "lora-karla",
    display: ofl("Lora", "google", [400, 600, 700], SERIF_FALLBACK),
    text: ofl("Karla", "google", [400, 500, 700], SANS_FALLBACK),
    character: "editorial-serif",
    displayScale: 2.6,
  },
  {
    id: "instrument-serif-geist",
    display: ofl("Instrument Serif", "google", [400], SERIF_FALLBACK),
    text: ofl("Geist", "google", [400, 500, 600], SANS_FALLBACK),
    character: "editorial-serif",
    displayScale: 4.0,
  },

  // ── swiss-grotesque ───────────────────────────────────────────────────────
  {
    id: "space-grotesk-plex",
    display: ofl("Space Grotesk", "google", [500, 700], SANS_FALLBACK),
    text: ofl("IBM Plex Sans", "google", [400, 500, 600], SANS_FALLBACK),
    character: "swiss-grotesque",
    displayScale: 3.0,
  },
  {
    id: "archivo-archivo-narrow",
    display: ofl("Archivo Expanded", "google", [600, 800], SANS_FALLBACK),
    text: ofl("Archivo", "google", [400, 500], SANS_FALLBACK),
    character: "swiss-grotesque",
    displayScale: 2.8,
  },
  {
    id: "manrope-inter",
    display: ofl("Manrope", "google", [600, 800], SANS_FALLBACK),
    text: ofl("Inter", "google", [400, 500], SANS_FALLBACK),
    character: "swiss-grotesque",
    displayScale: 2.4,
  },
  {
    id: "anton-work-sans",
    display: ofl("Anton", "google", [400], SANS_FALLBACK),
    text: ofl("Work Sans", "google", [400, 500, 600], SANS_FALLBACK),
    character: "swiss-grotesque",
    displayScale: 4.4,
  },

  // ── humanist-warm ─────────────────────────────────────────────────────────
  {
    id: "bricolage-figtree",
    display: ofl("Bricolage Grotesque", "google", [500, 700, 800], SANS_FALLBACK),
    text: ofl("Figtree", "google", [400, 500, 600], SANS_FALLBACK),
    character: "humanist-warm",
    displayScale: 3.1,
  },
  {
    id: "gentium-source-sans",
    display: ofl("Gentium Book Plus", "google", [400, 700], SERIF_FALLBACK),
    text: ofl("Source Sans 3", "google", [400, 600], SANS_FALLBACK),
    character: "humanist-warm",
    displayScale: 2.5,
  },
  {
    id: "newsreader-public-sans",
    display: ofl("Newsreader", "google", [400, 600], SERIF_FALLBACK),
    text: ofl("Public Sans", "google", [400, 500, 700], SANS_FALLBACK),
    character: "humanist-warm",
    displayScale: 2.9,
  },
  {
    id: "alegreya-alegreya-sans",
    display: ofl("Alegreya", "google", [500, 700, 800], SERIF_FALLBACK),
    text: ofl("Alegreya Sans", "google", [400, 500], SANS_FALLBACK),
    character: "humanist-warm",
    displayScale: 2.7,
  },

  // ── geometric-precise ─────────────────────────────────────────────────────
  {
    id: "outfit-dm-sans",
    display: ofl("Outfit", "google", [500, 700], SANS_FALLBACK),
    text: ofl("DM Sans", "google", [400, 500], SANS_FALLBACK),
    character: "geometric-precise",
    displayScale: 3.3,
  },
  {
    id: "poppins-mulish",
    display: ofl("Poppins", "google", [600, 700], SANS_FALLBACK),
    text: ofl("Mulish", "google", [400, 600], SANS_FALLBACK),
    character: "geometric-precise",
    displayScale: 2.6,
  },
  {
    id: "sora-inter-tight",
    display: ofl("Sora", "google", [600, 800], SANS_FALLBACK),
    text: ofl("Inter Tight", "google", [400, 500], SANS_FALLBACK),
    character: "geometric-precise",
    displayScale: 3.0,
  },
  {
    id: "syne-satoshi",
    display: ofl("Syne", "google", [600, 800], SANS_FALLBACK),
    text: ofl("Be Vietnam Pro", "google", [400, 500], SANS_FALLBACK),
    character: "geometric-precise",
    displayScale: 3.5,
  },

  // ── brutalist-mono ────────────────────────────────────────────────────────
  {
    id: "space-mono-ibm-plex",
    display: ofl("Space Mono", "google", [400, 700], MONO_FALLBACK),
    text: ofl("IBM Plex Sans", "google", [400, 500], SANS_FALLBACK),
    accent: ofl("IBM Plex Mono", "google", [400], MONO_FALLBACK),
    character: "brutalist-mono",
    displayScale: 2.2,
  },
  {
    id: "jetbrains-inter",
    display: ofl("JetBrains Mono", "google", [500, 700], MONO_FALLBACK),
    text: ofl("Inter", "google", [400, 500], SANS_FALLBACK),
    character: "brutalist-mono",
    displayScale: 2.0,
  },
  {
    id: "dm-mono-dm-sans",
    display: ofl("DM Mono", "google", [400, 500], MONO_FALLBACK),
    text: ofl("DM Sans", "google", [400, 500], SANS_FALLBACK),
    character: "brutalist-mono",
    displayScale: 2.3,
  },

  // ── transitional-classic ──────────────────────────────────────────────────
  {
    id: "libre-baskerville-libre-franklin",
    display: ofl("Libre Baskerville", "google", [400, 700], SERIF_FALLBACK),
    text: ofl("Libre Franklin", "google", [400, 500, 600], SANS_FALLBACK),
    character: "transitional-classic",
    displayScale: 2.8,
  },
  {
    id: "crimson-pro-nunito-sans",
    display: ofl("Crimson Pro", "google", [400, 600, 700], SERIF_FALLBACK),
    text: ofl("Nunito Sans", "google", [400, 600], SANS_FALLBACK),
    character: "transitional-classic",
    displayScale: 3.0,
  },
  {
    id: "eb-garamond-jost",
    display: ofl("EB Garamond", "google", [500, 600], SERIF_FALLBACK),
    text: ofl("Jost", "google", [400, 500], SANS_FALLBACK),
    character: "transitional-classic",
    displayScale: 3.2,
  },

  // ── condensed-utility ─────────────────────────────────────────────────────
  {
    id: "oswald-lato",
    display: ofl("Oswald", "google", [500, 600, 700], SANS_FALLBACK),
    text: ofl("Lato", "google", [400, 700], SANS_FALLBACK),
    character: "condensed-utility",
    displayScale: 3.4,
  },
  {
    id: "bebas-barlow",
    display: ofl("Bebas Neue", "google", [400], SANS_FALLBACK),
    text: ofl("Barlow", "google", [400, 500, 600], SANS_FALLBACK),
    character: "condensed-utility",
    displayScale: 4.2,
  },
  {
    id: "saira-condensed-saira",
    display: ofl("Saira Condensed", "google", [600, 700], SANS_FALLBACK),
    text: ofl("Saira", "google", [400, 500], SANS_FALLBACK),
    character: "condensed-utility",
    displayScale: 3.3,
  },

  // ── rounded-approachable ──────────────────────────────────────────────────
  {
    id: "baloo-nunito",
    display: ofl("Baloo 2", "google", [600, 700], SANS_FALLBACK),
    text: ofl("Nunito", "google", [400, 600], SANS_FALLBACK),
    character: "rounded-approachable",
    displayScale: 2.7,
  },
  {
    id: "quicksand-rubik",
    display: ofl("Quicksand", "google", [600, 700], SANS_FALLBACK),
    text: ofl("Rubik", "google", [400, 500], SANS_FALLBACK),
    character: "rounded-approachable",
    displayScale: 2.5,
  },
  {
    id: "fredoka-hanken",
    display: ofl("Fredoka", "google", [500, 600], SANS_FALLBACK),
    text: ofl("Hanken Grotesk", "google", [400, 500], SANS_FALLBACK),
    character: "rounded-approachable",
    displayScale: 2.9,
  },
];

/** Characters that suit a brand's voice. Keeps type from contradicting tone. */
export const CHARACTER_BY_TONE: Readonly<Record<string, readonly TypePairing["character"][]>> = {
  premium: ["editorial-serif", "transitional-classic", "swiss-grotesque"],
  playful: ["rounded-approachable", "humanist-warm", "geometric-precise"],
  technical: ["brutalist-mono", "swiss-grotesque", "geometric-precise"],
  crafted: ["editorial-serif", "humanist-warm", "transitional-classic"],
  utilitarian: ["condensed-utility", "swiss-grotesque", "brutalist-mono"],
  warm: ["humanist-warm", "rounded-approachable", "editorial-serif"],
};

export function pairingsForCharacters(
  characters: readonly TypePairing["character"][],
): readonly TypePairing[] {
  const matches = TYPE_PAIRINGS.filter((p) => characters.includes(p.character));
  return matches.length > 0 ? matches : TYPE_PAIRINGS;
}
