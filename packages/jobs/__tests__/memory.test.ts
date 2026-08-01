import { describe, expect, it, vi } from "vitest";
import { workOnce } from "../index.js";
import { MemoryJobQueue } from "../memory.js";

describe("durable job contract", () => {
  it("deduplicates keyed enqueues", async () => {
    const queue = new MemoryJobQueue();
    const first = await queue.enqueue("run.execute", { runId: "one" }, { idempotencyKey: "run:one" });
    const duplicate = await queue.enqueue("run.execute", { runId: "two" }, { idempotencyKey: "run:one" });
    expect(duplicate).toBe(first);
  });

  it("completes a handled job", async () => {
    const queue = new MemoryJobQueue();
    const handler = vi.fn(async () => undefined);
    const id = await queue.enqueue("mirror.sync", {});
    expect(await workOnce(queue, { "mirror.sync": handler })).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(queue.get(id)?.status).toBe("completed");
  });

  it("backs off and dead-letters at max attempts", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const queue = new MemoryJobQueue({ now: () => now, baseRetryMs: 10 });
    const id = await queue.enqueue("broken", {}, { maxAttempts: 2 });
    const broken = async () => { throw new Error("boom"); };

    await workOnce(queue, { broken });
    expect(queue.get(id)?.status).toBe("pending");
    expect(await queue.claim()).toBeUndefined();

    now = new Date(now.getTime() + 10);
    await workOnce(queue, { broken });
    expect(queue.get(id)?.status).toBe("failed");
    expect(queue.get(id)?.attempts).toBe(2);
  });

  it("records unregistered jobs as failures instead of losing them", async () => {
    const queue = new MemoryJobQueue({ baseRetryMs: 0 });
    const id = await queue.enqueue("unknown", {}, { maxAttempts: 1 });
    await workOnce(queue, {});
    expect(queue.get(id)?.status).toBe("failed");
    expect(queue.get(id)?.lastError).toMatchObject({ message: "No handler registered for job unknown" });
  });
});

