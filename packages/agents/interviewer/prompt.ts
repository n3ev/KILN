import { interviewer } from "../roster.js";

/** Fully composed Interviewer system prompt, including shared safety rules. */
export const buildPrompt = interviewer.systemPrompt;
