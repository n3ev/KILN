import { RUBRICS, type Rubric } from "@kiln/quality";
import type { AnyAgent } from "./types.js";

/** Resolve an agent's optional rubric without making per-role copies. */
export function resolveAgentRubric(agent: AnyAgent): Rubric | undefined {
  return agent.rubric ? RUBRICS[agent.rubric] : undefined;
}
