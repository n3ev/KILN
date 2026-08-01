import { resolveAgentRubric } from "../module.js";
import { interviewer } from "../roster.js";

export const rubric = resolveAgentRubric(interviewer);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
