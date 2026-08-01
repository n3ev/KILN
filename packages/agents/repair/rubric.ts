import { resolveAgentRubric } from "../module.js";
import { repair } from "../roster.js";

export const rubric = resolveAgentRubric(repair);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
