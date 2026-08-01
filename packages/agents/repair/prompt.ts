import { repair } from "../roster.js";

/** Fully composed Repair system prompt, including shared safety rules. */
export const buildPrompt = repair.systemPrompt;
