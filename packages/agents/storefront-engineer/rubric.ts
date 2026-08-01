import { resolveAgentRubric } from "../module.js";
import { storefrontEngineer } from "../roster.js";

export const rubric = resolveAgentRubric(storefrontEngineer);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
