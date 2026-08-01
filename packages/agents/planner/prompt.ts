import { planner } from "../roster.js";

/** Fully composed Planner system prompt, including shared safety rules. */
export const buildPrompt = planner.systemPrompt;
