import { describe, expect, it } from "vitest";
import { loadConfig } from "../env.js";

describe("loadConfig", () => {
  it("boots from an empty environment in safe offline mode", () => {
    const cfg = loadConfig({});
    expect(cfg.MODEL_PROVIDER).toBe("mock");
    expect(cfg.availableProviders).toEqual(["mock"]);
    expect(cfg.sandbox).toBe(true);
    expect(cfg.embeddedDatabase).toBe(true);
    expect(cfg.DEMO_MODE).toBe(true);
    expect(cfg.ENABLE_MCP_SERVER).toBe(true);
    expect(cfg.MCP_PORT).toBe(3100);
    expect(cfg.WORKER_POLL_MS).toBe(1_000);
  });

  it("puts MODEL_PROVIDER first and preserves configured fallbacks", () => {
    const cfg = loadConfig({
      MODEL_PROVIDER: "kimi",
      MODEL_FALLBACK_ORDER: "deepseek,mock",
      KIMI_API_KEY: "test-kimi-key",
      DEEPSEEK_API_KEY: "test-deepseek-key",
    });
    expect(cfg.availableProviders).toEqual(["kimi", "deepseek", "mock"]);
  });

  it("degrades to mock when the selected live provider has no key", () => {
    const cfg = loadConfig({ MODEL_PROVIDER: "kimi", MODEL_FALLBACK_ORDER: "mock" });
    expect(cfg.availableProviders).toEqual(["mock"]);
  });

  it("supports SANDBOX_MODE while giving the legacy KILN_SANDBOX alias precedence", () => {
    expect(loadConfig({ SANDBOX_MODE: "0" }).sandbox).toBe(false);
    expect(loadConfig({ SANDBOX_MODE: "0", KILN_SANDBOX: "1" }).sandbox).toBe(true);
  });

  it("rejects malformed operator values with the variable path", () => {
    expect(() => loadConfig({ MODEL_PROVIDER: "unknown" })).toThrow(/MODEL_PROVIDER/);
    expect(() => loadConfig({ MCP_PORT: "70000" })).toThrow(/MCP_PORT/);
    expect(() => loadConfig({ APP_URL: "not a url" })).toThrow(/APP_URL/);
    expect(() => loadConfig({ KILN_SANDBOX: "definitely" })).toThrow(/KILN_SANDBOX/);
    expect(() => loadConfig({ MODEL_RECORD: "sometimes" })).toThrow(/MODEL_RECORD/);
  });
});
