/**
 * Deterministic pseudo-randomness.
 *
 * Every design decision derives from the run seed, so a replay produces byte
 * identical tokens and a prompt change can be diffed against what it replaced.
 * `Math.random()` must never appear in this package.
 *
 * mulberry32: small, fast, and good enough for choosing fonts. It is not a CSPRNG
 * and nothing security-relevant may use it.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates, non-mutating. */
  shuffle<T>(items: readonly T[]): T[];
  bool(probability?: number): boolean;
  /** Derives an independent stream, so adding a decision cannot shift others. */
  fork(label: string): Rng;
}

export function hashString(input: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashString(seed);

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    pick: (items) => {
      if (items.length === 0) throw new Error("createRng().pick called with an empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        const b = copy[j] as (typeof copy)[number];
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
    bool: (probability = 0.5) => next() < probability,
    /**
     * Forked streams are why the palette does not change when a new font is
     * added to the catalogue: each decision consumes from its own stream.
     */
    fork: (label) => createRng(`${seed}::${label}`),
  };

  return rng;
}
