import { describe, expect, it } from "vitest";
import { canonicalise, contentHash, idempotencyKey, normaliseNumber, stripIgnored } from "../canonical.js";

/**
 * Property tests for the canonicaliser.
 *
 * Replay correctness rests on these properties. If key order changed the hash,
 * a replayed run would redo work it had already done — and for a `spend` tool
 * that means charging a customer twice.
 */

const key = (input: unknown, ignore: string[] = []): string =>
  idempotencyKey({ runId: "run-1", toolId: "shopify.product.upsert", toolVersion: "1.0.0", input, ignore });

describe("number normalisation", () => {
  it("collapses equivalent representations", () => {
    expect(normaliseNumber(1)).toBe(normaliseNumber(1.0));
    expect(normaliseNumber(1.5)).toBe(normaliseNumber(1.5000));
  });

  it("keeps distinct numbers distinct", () => {
    expect(normaliseNumber(1.5)).not.toBe(normaliseNumber(1.6));
  });

  it("survives float representation noise", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    expect(normaliseNumber(0.1 + 0.2)).toBe(normaliseNumber(0.3));
  });

  it("handles the non-finite cases without throwing", () => {
    expect(normaliseNumber(NaN)).toBe("NaN");
    expect(normaliseNumber(Infinity)).toBe("Infinity");
  });
});

describe("canonicalise", () => {
  it("is insensitive to object key order", () => {
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
  });

  it("is insensitive to key order at every depth", () => {
    const one = { outer: { x: 1, y: { p: true, q: "s" } } };
    const two = { outer: { y: { q: "s", p: true }, x: 1 } };
    expect(canonicalise(one)).toBe(canonicalise(two));
  });

  it("is sensitive to array order, because [a,b] is a different request from [b,a]", () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it("drops undefined values but preserves explicit null", () => {
    expect(canonicalise({ a: 1, b: undefined })).toBe(canonicalise({ a: 1 }));
    expect(canonicalise({ a: 1, b: null })).not.toBe(canonicalise({ a: 1 }));
  });

  it("emits no whitespace", () => {
    expect(canonicalise({ a: 1, b: [1, 2] })).not.toMatch(/\s/);
  });

  it("distinguishes a numeric string from a number", () => {
    expect(canonicalise({ v: "1" })).not.toBe(canonicalise({ v: 1 }));
  });

  it("refuses values that cannot be meaningfully hashed", () => {
    expect(() => canonicalise({ fn: () => 1 })).toThrow(TypeError);
  });
});

describe("stripIgnored", () => {
  it("removes a top-level path", () => {
    expect(stripIgnored({ a: 1, ts: "now" }, ["ts"])).toEqual({ a: 1 });
  });

  it("removes a nested path", () => {
    expect(stripIgnored({ meta: { ts: "now", id: 2 } }, ["meta.ts"])).toEqual({ meta: { id: 2 } });
  });

  it("removes a path from every array element with a wildcard", () => {
    const input = { items: [{ sku: "a", ts: 1 }, { sku: "b", ts: 2 }] };
    expect(stripIgnored(input, ["items.*.ts"])).toEqual({ items: [{ sku: "a" }, { sku: "b" }] });
  });

  it("leaves unrelated data alone", () => {
    const input = { a: { b: 1 } };
    expect(stripIgnored(input, ["x.y"])).toEqual(input);
  });
});

describe("idempotencyKey", () => {
  it("is stable across key reordering", () => {
    expect(key({ title: "Holder", price: 3400 })).toBe(key({ price: 3400, title: "Holder" }));
  });

  it("changes when the input changes", () => {
    expect(key({ title: "Holder" })).not.toBe(key({ title: "Stand" }));
  });

  it("ignores declared paths, so a timestamp does not defeat replay", () => {
    const a = { title: "Holder", requestedAt: "2026-08-01T10:00:00Z" };
    const b = { title: "Holder", requestedAt: "2026-08-01T11:30:00Z" };
    expect(key(a, ["requestedAt"])).toBe(key(b, ["requestedAt"]));
  });

  it("does not ignore those paths unless asked", () => {
    const a = { title: "Holder", requestedAt: "2026-08-01T10:00:00Z" };
    const b = { title: "Holder", requestedAt: "2026-08-01T11:30:00Z" };
    expect(key(a)).not.toBe(key(b));
  });

  it("scopes by run, so two ventures cannot collide", () => {
    const input = { title: "Holder" };
    const runA = idempotencyKey({ runId: "run-a", toolId: "t.x", toolVersion: "1", input });
    const runB = idempotencyKey({ runId: "run-b", toolId: "t.x", toolVersion: "1", input });
    expect(runA).not.toBe(runB);
  });

  it("scopes by tool version, so changed semantics do not reuse old results", () => {
    const input = { title: "Holder" };
    const v1 = idempotencyKey({ runId: "r", toolId: "t.x", toolVersion: "1.0.0", input });
    const v2 = idempotencyKey({ runId: "r", toolId: "t.x", toolVersion: "2.0.0", input });
    expect(v1).not.toBe(v2);
  });
});

describe("contentHash", () => {
  it("gives identical artifacts identical hashes", () => {
    expect(contentHash({ a: 1, b: [2, 3] })).toBe(contentHash({ b: [2, 3], a: 1 }));
  });

  it("is a full sha256", () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
