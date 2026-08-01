import type { z } from "zod";
import { interviewer } from "../roster.js";

export const inputSchema = interviewer.input;
export const outputSchema = interviewer.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
