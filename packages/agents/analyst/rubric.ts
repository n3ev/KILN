import { resolveAgentRubric } from "../module.js";
import { analyst } from "../roster.js";

export const rubric = resolveAgentRubric(analyst);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
