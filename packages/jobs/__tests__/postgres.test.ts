import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache } from "@kiln/config";
import { closeDb } from "@kiln/db";
import { applySchema } from "@kiln/db/migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresJobQueue } from "../index.js";

const temp = mkdtempSync(join(tmpdir(), "kiln-jobs-"));

beforeAll(async () => {
  process.env["KILN_PGDATA"] = join(temp, "pgdata");
  resetConfigCache();
  await applySchema();
});

afterAll(async () => {
  await closeDb();
  delete process.env["KILN_PGDATA"];
  resetConfigCache();
  rmSync(temp, { recursive: true, force: true });
});

describe("Postgres job queue", () => {
  it("is idempotent under duplicate delivery", async () => {
    const queue = new PostgresJobQueue({ workerId: "idempotency-test" });
    const first = await queue.enqueue("run.execute", { runId: "first" }, { idempotencyKey: "same-event" });
    const replay = await queue.enqueue("run.execute", { runId: "replayed" }, { idempotencyKey: "same-event" });
    expect(replay).toBe(first);
    const claimed = await queue.claim();
    expect(claimed).toMatchObject({ id: first, payload: { runId: "first" }, attempts: 1 });
    expect(await queue.complete(first)).toBe(true);
  });

  it("backs off retries and marks the terminal attempt failed", async () => {
    const queue = new PostgresJobQueue({ workerId: "retry-test", baseRetryMs: 0 });
    const id = await queue.enqueue("test.fail", {}, { maxAttempts: 2 });
    expect((await queue.claim())?.id).toBe(id);
    expect(await queue.fail(id, new Error("first"))).toBe("pending");
    expect((await queue.claim())?.attempts).toBe(2);
    expect(await queue.fail(id, new Error("second"))).toBe("failed");
    expect(await queue.claim()).toBeUndefined();
  });

  it("lets competing workers claim different rows", async () => {
    const left = new PostgresJobQueue({ workerId: "left" });
    const right = new PostgresJobQueue({ workerId: "right" });
    const ids = await Promise.all([
      left.enqueue("parallel", { position: 1 }),
      left.enqueue("parallel", { position: 2 }),
    ]);
    const claims = await Promise.all([left.claim(), right.claim()]);
    expect(new Set(claims.map((job) => job?.id))).toEqual(new Set(ids));
    await Promise.all([
      claims[0] ? left.complete(claims[0].id) : Promise.resolve(false),
      claims[1] ? right.complete(claims[1].id) : Promise.resolve(false),
    ]);
  });
});

