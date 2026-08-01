import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrandSystem,
  CritiqueVerdict,
  StrategyMemo,
  SyntheticResponseFailure,
  UnitEconomicsModel,
  ValidationReport,
  VentureBrief,
} from "@kiln/contracts";
import { slopLint } from "@kiln/quality";
import { resetConfigCache } from "@kiln/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModelGateway } from "../gateway.js";
import { createKimiProvider } from "../providers/index.js";
import { createMockProvider } from "../providers/mock.js";
import { synthesize } from "../synth.js";
import type { ChatRequest } from "../types.js";

const ctx = { agentId: "analyst", taskKind: "validate", seed: "test-seed" } as const;

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: "user", content: "Assess demand for handmade incense holders." }],
  selector: { tier: "fast" },
  context: ctx,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});

describe("provider selection boundary", () => {
  it("resolves the documented Kimi tier variables without a code change", () => {
    vi.stubEnv("MODEL_PROVIDER", "kimi");
    vi.stubEnv("MODEL_FALLBACK_ORDER", "mock");
    vi.stubEnv("KIMI_API_KEY", "configured-for-selection-test");
    vi.stubEnv("KIMI_MODEL_DEEP", "operator-kimi-deep");
    vi.stubEnv("KIMI_MODEL_FAST", "operator-kimi-fast");
    resetConfigCache();

    const provider = createKimiProvider();
    expect(provider.resolveModel({ tier: "deep" })).toBe("operator-kimi-deep");
    expect(provider.resolveModel({ tier: "fast" })).toBe("operator-kimi-fast");
  });

  it("keeps provider-specific names out of production branching above the gateway", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const offenders: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist", ".next", "__tests__"].includes(entry.name)) continue;
          if (path === resolve(root, "packages/model-gateway") || path === resolve(root, "packages/config")) continue;
          visit(path);
        } else if (/\.tsx?$/.test(entry.name) && /\b(?:kimi|deepseek)\b/i.test(readFileSync(path, "utf8"))) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    visit(resolve(root, "packages"));
    visit(resolve(root, "apps"));
    expect(offenders).toEqual([]);
  });
});

describe("schema synthesis", () => {
  it("satisfies every real artifact contract", () => {
    // The contracts with refinements and deep nesting are exactly the ones a
    // naive synthesiser fails on, so they are the ones worth asserting.
    for (const [name, schema] of [
      ["VentureBrief", VentureBrief],
      ["ValidationReport", ValidationReport],
      ["UnitEconomicsModel", UnitEconomicsModel],
      ["StrategyMemo", StrategyMemo],
      ["BrandSystem", BrandSystem],
    ] as const) {
      const value = synthesize(schema, `seed-${name}`);
      expect(schema.safeParse(value).success, name).toBe(true);
    }
  });

  it("is deterministic for a given seed", () => {
    expect(synthesize(StrategyMemo, "same")).toEqual(synthesize(StrategyMemo, "same"));
  });

  it("differs across seeds", () => {
    expect(synthesize(StrategyMemo, "a")).not.toEqual(synthesize(StrategyMemo, "b"));
  });

  it("honours a discriminated union's refinements", () => {
    // ValidationReport refines: a kill verdict must carry killRationale.
    for (let i = 0; i < 20; i++) {
      const report = synthesize(ValidationReport, `verdict-${i}`);
      if (report.verdict === "kill") expect(report.killRationale).toBeDefined();
      if (report.verdict === "reshape") expect(report.reshapeProposal).toBeDefined();
    }
  });

  it("respects string length bounds", () => {
    const schema = z.object({ short: z.string().max(10), long: z.string().min(200) });
    const value = synthesize(schema, "bounds");
    expect(value.short.length).toBeLessThanOrEqual(10);
    expect(value.long.length).toBeGreaterThanOrEqual(200);
  });

  it("respects numeric bounds and integrality", () => {
    const schema = z.object({ n: z.number().int().min(5).max(7) });
    const value = synthesize(schema, "nums");
    expect(Number.isInteger(value.n)).toBe(true);
    expect(value.n).toBeGreaterThanOrEqual(5);
    expect(value.n).toBeLessThanOrEqual(7);
  });

  it("throws a typed failure on an unsatisfiable schema rather than returning junk", () => {
    const impossible = z.object({ x: z.string() }).refine(() => false, { message: "never satisfiable" });
    expect(() => synthesize(impossible, "impossible", 2)).toThrow(SyntheticResponseFailure);
  });

  it("names the schema path that defeated it", () => {
    const impossible = z.object({ nested: z.object({ deep: z.number().min(10).max(1) }) });
    try {
      synthesize(impossible, "bounds-conflict", 1);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SyntheticResponseFailure);
      expect((error as SyntheticResponseFailure).schemaPath).toContain("nested");
    }
  });

  it("produces prose that passes KILN's own slop linter", () => {
    // A mock that emits banned phrases would fail every offline quality gate,
    // which is a baffling way to learn your fixtures are stale.
    const memo = synthesize(StrategyMemo, "prose-check");
    const result = slopLint(memo.icp.portrait + " " + memo.differentiation.statement);
    expect(result.findings.filter((f) => f.rule === "banned-phrase")).toEqual([]);
  });

  it("satisfies the Critic's dependent pass/fail refinements", () => {
    const verdict = synthesize(CritiqueVerdict, "critic-verdict");
    expect(CritiqueVerdict.safeParse(verdict).success).toBe(true);
    expect(verdict.passed).toBe(true);
    expect(verdict.scores.every((score) => score.score >= 4)).toBe(true);
  });
});

describe("mock provider", () => {
  it("streams in multiple chunks so the Run Theatre is genuinely exercised", async () => {
    const provider = createMockProvider({ jitterMs: 0 });
    const chunks: string[] = [];
    for await (const chunk of provider.chat(request({ outputSchema: UnitEconomicsModel }))) {
      if (chunk.type === "text") chunks.push(chunk.text);
    }
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("ends the stream with a done chunk carrying usage", async () => {
    const provider = createMockProvider({ jitterMs: 0 });
    let done: { promptTokens: number; completionTokens: number } | undefined;
    for await (const chunk of provider.chat(request())) {
      if (chunk.type === "done") done = chunk.result.usage;
    }
    expect(done?.completionTokens).toBeGreaterThan(0);
  });

  it("is deterministic given the run seed", async () => {
    const a = await createMockProvider().complete(request({ outputSchema: StrategyMemo }));
    const b = await createMockProvider().complete(request({ outputSchema: StrategyMemo }));
    expect(a.text).toBe(b.text);
  });

  it("changes synthetic output when the semantic input changes", async () => {
    const provider = createMockProvider();
    const a = await provider.complete(request({
      messages: [{ role: "user", content: "Build for ceramic incense holders." }],
      outputSchema: StrategyMemo,
    }));
    const b = await provider.complete(request({
      messages: [{ role: "user", content: "Build for a mobile bicycle repair service." }],
      outputSchema: StrategyMemo,
    }));
    expect(a.text).not.toBe(b.text);
  });
});

describe("gateway", () => {
  let gw: ModelGateway;

  beforeEach(() => {
    gw = new ModelGateway({ order: ["mock"] });
  });

  it("returns a validated object", async () => {
    const value = await gw.generateObject({
      schema: UnitEconomicsModel,
      request: request(),
      schemaName: "UnitEconomicsModel",
    });
    expect(UnitEconomicsModel.safeParse(value).success).toBe(true);
  });

  it("reserves budget before the call and settles after", async () => {
    const events: string[] = [];
    const guarded = new ModelGateway({
      order: ["mock"],
      budget: {
        reserve: () => void events.push("reserve"),
        settle: () => void events.push("settle"),
        release: () => void events.push("release"),
      },
    });
    await guarded.complete(request());
    expect(events).toEqual(["reserve", "settle"]);
  });

  it("releases the reservation when the call fails", async () => {
    const events: string[] = [];
    const failing = new ModelGateway({
      order: ["mock"],
      maxRetries: 1,
      budget: {
        reserve: () => void events.push("reserve"),
        settle: () => void events.push("settle"),
        release: () => void events.push("release"),
      },
    });
    // An unsatisfiable schema makes the mock throw on every provider.
    const impossible = z.object({ x: z.number().min(10).max(1) });
    await expect(
      failing.complete(request({ outputSchema: impossible })),
    ).rejects.toThrow(SyntheticResponseFailure);
    expect(events).toEqual(["reserve", "release"]);
  });

  it("records cost against the run", async () => {
    const recorded: { costMicros: number; agentId: string }[] = [];
    const metered = new ModelGateway({
      order: ["mock"],
      costSink: { record: (e) => void recorded.push({ costMicros: e.costMicros, agentId: e.agentId }) },
    });
    await metered.complete(request());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.agentId).toBe("analyst");
  });

  it("does not fail over on a synthesis failure, which is a real defect", async () => {
    const impossible = z.object({ x: z.number().min(10).max(1) });
    await expect(gw.complete(request({ outputSchema: impossible }))).rejects.toBeInstanceOf(
      SyntheticResponseFailure,
    );
  });

  it("parses JSON wrapped in markdown fences", async () => {
    // Exercises the tolerant parser through the public path.
    const value = await gw.generateObject({ schema: z.object({ ok: z.boolean() }), request: request() });
    expect(typeof value.ok).toBe("boolean");
  });
});
