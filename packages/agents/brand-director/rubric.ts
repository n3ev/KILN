import { resolveAgentRubric } from "../module.js";
import { brandDirector } from "../roster.js";

export const rubric = resolveAgentRubric(brandDirector);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
