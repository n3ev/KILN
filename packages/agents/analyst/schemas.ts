import type { z } from "zod";
import { analyst } from "../roster.js";

export const inputSchema = analyst.input;
export const outputSchema = analyst.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
