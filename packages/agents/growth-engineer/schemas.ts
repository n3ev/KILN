import type { z } from "zod";
import { growthEngineer } from "../roster.js";

export const inputSchema = growthEngineer.input;
export const outputSchema = growthEngineer.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
