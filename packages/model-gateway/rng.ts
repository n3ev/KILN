/**
 * Seeded PRNG for the mock provider.
 *
 * Deliberately a local copy of the same mulberry32 in @kiln/design-engine
 * rather than an import: the alternative is a dependency edge from the model
 * gateway to the design system, which would be a lie about how the system is
 * layered. Forty lines of a well-specified algorithm is the cheaper price.
 *
 * Not a CSPRNG. Nothing security-relevant may use it.
 */

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  bool(probability?: number): boolean;
  fork(label: string): Rng;
}

export function hashString(input: string): number {
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

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    pick: (items) => {
      if (items.length === 0) throw new Error("Rng.pick called with an empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    bool: (probability = 0.5) => next() < probability,
    fork: (label) => createRng(`${seed}::${label}`),
  };
}
