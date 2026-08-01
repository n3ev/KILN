import { resolveAgentRubric } from "../module.js";
import { growthEngineer } from "../roster.js";

export const rubric = resolveAgentRubric(growthEngineer);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
