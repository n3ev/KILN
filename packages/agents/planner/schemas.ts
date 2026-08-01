import type { z } from "zod";
import { planner } from "../roster.js";

export const inputSchema = planner.input;
export const outputSchema = planner.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
