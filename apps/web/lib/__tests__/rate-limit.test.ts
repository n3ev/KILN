import { describe, expect, it } from "vitest";
import { clientIp } from "../rate-limit";

describe("mutation rate-limit identity", () => {
  it("uses the first trusted proxy hop", () => {
    const request = new Request("https://kiln.test", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.4", "x-real-ip": "198.51.100.2" },
    });
    expect(clientIp(request)).toBe("203.0.113.9");
  });

  it("does not persist attacker-controlled header text as an IP", () => {
    const request = new Request("https://kiln.test", {
      headers: { "x-forwarded-for": "203.0.113.9\" DROP TABLE audit_log" },
    });
    expect(clientIp(request)).toBe("unknown");
  });
});
