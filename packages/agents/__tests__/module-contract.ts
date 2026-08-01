import type { AgentId } from "@kiln/contracts";
import type { Rubric } from "@kiln/quality";
import type { z } from "zod";
import { expect } from "vitest";
import { requireAgent } from "../roster.js";
import type { AnyAgent } from "../types.js";

export interface AgentModuleSurface {
  readonly agent: AnyAgent;
  readonly buildPrompt: AnyAgent["systemPrompt"];
  readonly inputSchema: z.ZodTypeAny;
  readonly outputSchema: z.ZodTypeAny;
  readonly rubric: Rubric | undefined;
  readonly rubricId: string | undefined;
  readonly usesCritic: boolean;
}

/** Shared assertions; every role keeps its own focused discovery test. */
export function expectAgentModule(expectedId: AgentId, surface: AgentModuleSurface): void {
  const registered = requireAgent(expectedId);
  expect(surface.agent).toBe(registered);
  expect(surface.buildPrompt).toBe(registered.systemPrompt);
  expect(surface.inputSchema).toBe(registered.input);
  expect(surface.outputSchema).toBe(registered.output);
  expect(surface.rubricId).toBe(registered.rubric);
  expect(surface.rubric?.id).toBe(registered.rubric);
  expect(surface.usesCritic).toBe(registered.rubric !== undefined);
}
