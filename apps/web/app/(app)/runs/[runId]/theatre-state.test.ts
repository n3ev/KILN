import { describe, expect, it } from "vitest";
import { replayDelayMs } from "./theatre-state.js";

describe("Run Theatre replay timing", () => {
  it("preserves speed ratios for normal recorded gaps", () => {
    const before = "2026-01-01T00:00:00.000Z";
    const after = "2026-01-01T00:00:00.800Z";
    expect(replayDelayMs(before, after, 1)).toBe(800);
    expect(replayDelayMs(before, after, 4)).toBe(200);
    expect(replayDelayMs(before, after, 16)).toBe(50);
  });

  it("compresses idle gaps and keeps the first event responsive", () => {
    expect(replayDelayMs("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", 1)).toBe(1_500);
    expect(replayDelayMs(undefined, "2026-01-01T00:00:00.000Z", 16)).toBe(8);
  });
});
