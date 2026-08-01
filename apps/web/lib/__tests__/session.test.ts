import { describe, expect, it } from "vitest";
import { assertOwnerSession, SessionAccessError, type AppSession } from "../session";

const base: AppSession = {
  userId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  email: "owner@example.test",
  name: "Owner",
  role: "owner",
  mode: "offline",
};

describe("owner session guard", () => {
  it("admits owners and refuses members and platform admins", () => {
    expect(assertOwnerSession(base)).toBe(base);
    for (const role of ["member", "admin"] as const) {
      expect(() => assertOwnerSession({ ...base, role })).toThrowError(SessionAccessError);
    }
  });
});
