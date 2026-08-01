import { resolveAgentRubric } from "../module.js";
import { planner } from "../roster.js";

export const rubric = resolveAgentRubric(planner);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
