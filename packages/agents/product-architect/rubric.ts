import { resolveAgentRubric } from "../module.js";
import { productArchitect } from "../roster.js";

export const rubric = resolveAgentRubric(productArchitect);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
