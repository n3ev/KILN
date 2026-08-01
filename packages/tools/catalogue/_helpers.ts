import { isEnabled, type FlagName } from "@kiln/config";
import { createRng, type Rng } from "@kiln/design-engine";
import type { ToolContext } from "../core/define.js";

/**
 * Shared helpers for the catalogue.
 *
 * Two conventions every tool follows:
 *
 *   - `simulate` derives all randomness from `seedFor(ctx, ...)`, so a
 *     simulated run is byte-identical on replay. A simulation that used
 *     Math.random() would make the replay harness useless.
 *   - `requireLive` guards `execute` paths that need a partner account KILN
 *     does not have yet. The live code is written against the documented API
 *     and sits behind a feature flag; the simulation is always complete.
 */

export function seedFor(ctx: ToolContext, ...parts: (string | number)[]): Rng {
  return createRng([ctx.seed, ctx.runId, ...parts.map(String)].join("::"));
}

export class LiveAdapterUnavailable extends Error {
  constructor(
    readonly toolId: string,
    readonly flag: FlagName | string,
    readonly detail: string,
  ) {
    super(
      `Live adapter for "${toolId}" is not enabled (flag: ${flag}). ${detail} ` +
        `Runs in sandbox mode use the simulated path instead.`,
    );
    this.name = "LiveAdapterUnavailable";
  }
}

export function requireLive(toolId: string, flag: FlagName, detail: string): void {
  if (!isEnabled(flag)) throw new LiveAdapterUnavailable(toolId, flag, detail);
}

/** Deterministic id in a provider's shape, so simulated ids look plausible. */
export function fakeId(rng: Rng, prefix: string, length = 12): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const body = Array.from({ length }, () => alphabet[rng.int(0, alphabet.length - 1)] ?? "0").join("");
  return `${prefix}_${body}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isoIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Stable clock for simulations. Wall time must never enter replay output. */
export function isoFor(ctx: ToolContext, key: string, days = 0): string {
  const rng = seedFor(ctx, "clock", key);
  const epoch = Date.UTC(2026, 7, 1, 12, 0, 0, 0);
  const minuteOffset = rng.int(0, 24 * 60 - 1);
  return new Date(epoch + days * 86_400_000 + minuteOffset * 60_000).toISOString();
}

/** Money helper: whole currency units → micros. */
export const units = (n: number): number => Math.round(n * 1_000_000);
