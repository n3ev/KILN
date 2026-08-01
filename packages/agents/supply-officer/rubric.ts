import { resolveAgentRubric } from "../module.js";
import { supplyOfficer } from "../roster.js";

export const rubric = resolveAgentRubric(supplyOfficer);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
