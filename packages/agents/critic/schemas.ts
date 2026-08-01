import type { z } from "zod";
import { critic } from "../roster.js";

export const inputSchema = critic.input;
export const outputSchema = critic.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
