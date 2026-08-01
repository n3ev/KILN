import { resolveAgentRubric } from "../module.js";
import { contentStudio } from "../roster.js";

export const rubric = resolveAgentRubric(contentStudio);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
