import type { z } from "zod";
import { strategist } from "../roster.js";

export const inputSchema = strategist.input;
export const outputSchema = strategist.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
