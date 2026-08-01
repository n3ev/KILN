import type { z } from "zod";
import { operator } from "../roster.js";

export const inputSchema = operator.input;
export const outputSchema = operator.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
