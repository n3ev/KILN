import { resolveAgentRubric } from "../module.js";
import { operator } from "../roster.js";

export const rubric = resolveAgentRubric(operator);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
