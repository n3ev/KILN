import { resolveAgentRubric } from "../module.js";
import { critic } from "../roster.js";

export const rubric = resolveAgentRubric(critic);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
