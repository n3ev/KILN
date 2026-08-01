import { resolveAgentRubric } from "../module.js";
import { complianceOfficer } from "../roster.js";

export const rubric = resolveAgentRubric(complianceOfficer);
export const rubricId = rubric?.id;
export const usesCritic = rubric !== undefined;
