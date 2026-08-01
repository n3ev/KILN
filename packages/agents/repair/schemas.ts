import type { z } from "zod";
import { repair } from "../roster.js";

export const inputSchema = repair.input;
export const outputSchema = repair.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
