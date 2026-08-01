import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "@kiln/observability";
import type { ChatRequest, ChatResult } from "./types.js";

/**
 * The recorded-response corpus behind the mock provider.
 *
 * Keyed by a stable hash of (agentId, taskKind, inputDigest) so the same task
 * with the same inputs always replays the same answer. `MODEL_RECORD=1`
 * alongside a real key writes live responses back here, which grows the offline
 * corpus for free and makes the demo path better every time someone runs the
 * product against a real provider.
 */

export interface Fixture {
  readonly key: string;
  readonly agentId: string;
  readonly taskKind: string;
  readonly recordedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly result: ChatResult;
}

function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

export function fixtureDir(): string {
  return process.env["KILN_MODEL_FIXTURES"] ?? join(repoRoot(), "fixtures", "model");
}

/**
 * Digests the semantic inputs of a request.
 *
 * System prompts are included because a prompt edit should invalidate the
 * fixture — replaying an old answer against new instructions is exactly the
 * silent staleness that makes recorded corpora untrustworthy.
 */
export function inputDigest(req: ChatRequest): string {
  const material = JSON.stringify({
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    tools: (req.tools ?? []).map((t) => t.name).sort(),
    json: req.json ?? false,
    tier: req.selector.tier,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function fixtureKey(req: ChatRequest): string {
  const { agentId, taskKind } = req.context;
  return `${agentId}__${taskKind}__${inputDigest(req)}`;
}

export function loadFixture(key: string): Fixture | undefined {
  const path = join(fixtureDir(), `${key}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Fixture;
  } catch (error) {
    // A corrupt fixture must not take down a run — fall through to synthesis.
    logger.warn("ignoring unreadable model fixture", { key, error: String(error) });
    return undefined;
  }
}

export function saveFixture(req: ChatRequest, result: ChatResult): void {
  const key = fixtureKey(req);
  const dir = fixtureDir();
  mkdirSync(dir, { recursive: true });

  const fixture: Fixture = {
    key,
    agentId: req.context.agentId,
    taskKind: req.context.taskKind,
    recordedAt: new Date().toISOString(),
    provider: result.provider,
    model: result.model,
    result,
  };

  writeFileSync(join(dir, `${key}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  logger.info("recorded model fixture", { key, agentId: req.context.agentId });
}
