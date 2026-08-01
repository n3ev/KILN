import { resolveAgentRubric } from "../module.js";
import { strategist } from "../roster.js";

export const rubric = resolveAgentRubric(strategist);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
