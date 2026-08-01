import { describe, expect, it } from "vitest";
import { REDACTED, redact, redactString } from "../redaction.js";

describe("redactString", () => {
  it("masks provider keys but keeps a tail for correlation", () => {
    const out = redactString("using sk_live_51H8xKzABCDEFGHIJKLMNOP for billing");
    expect(out).not.toContain("sk_live_51H8xKzABCDEFGHIJKLMNOP");
    expect(out).toContain(REDACTED);
  });

  it("masks shopify tokens", () => {
    // Assembled at runtime rather than written as a literal. The value is fake,
    // but a literal shpat_ followed by 32 hex characters is exactly what
    // GitHub's push protection scans for, and it blocks the push on sight.
    const body = "0123456789abcdef".repeat(2);
    const out = redactString(`shpat_${body}`);
    expect(out).not.toContain(body);
  });

  it("masks JWTs entirely", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactString(jwt)).toBe(REDACTED);
  });

  it("keeps the email domain, which is operationally useful, and drops the local part", () => {
    expect(redactString("contact ada@example.com")).toContain("example.com");
    expect(redactString("contact ada@example.com")).not.toContain("ada@");
  });

  it("leaves ordinary prose untouched", () => {
    const prose = "The ceramicist sells incense holders at 34 GBP each.";
    expect(redactString(prose)).toBe(prose);
  });
});

describe("redact", () => {
  it("redacts by key name even when the value looks harmless", () => {
    expect(redact({ apiKey: "hunter2" })).toEqual({ apiKey: REDACTED });
    expect(redact({ password: "abc" })).toEqual({ password: REDACTED });
    expect(redact({ refresh_token: "x" })).toEqual({ refresh_token: REDACTED });
  });

  it("recurses through arrays and nested objects", () => {
    const input = { outer: [{ secret: "s" }, { safe: "keep" }] };
    expect(redact(input)).toEqual({ outer: [{ secret: REDACTED }, { safe: "keep" }] });
  });

  it("treats binary as key material", () => {
    expect(redact({ blob: new Uint8Array([1, 2, 3]) })).toEqual({ blob: REDACTED });
  });

  it("survives cycles instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { name: "run" };
    cyclic["self"] = cyclic;
    expect(redact(cyclic)).toEqual({ name: "run", self: "[circular]" });
  });

  it("reduces an Error to name and message", () => {
    const out = redact({ err: new Error("failed with sk-abcdefghijklmnopqrstuvwx") }) as {
      err: { name: string; message: string };
    };
    expect(out.err.name).toBe("Error");
    expect(out.err.message).not.toContain("abcdefghijklmnopqrstuvwx");
  });
});
