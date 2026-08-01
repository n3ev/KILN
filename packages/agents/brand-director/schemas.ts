import type { z } from "zod";
import { brandDirector } from "../roster.js";

export const inputSchema = brandDirector.input;
export const outputSchema = brandDirector.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
