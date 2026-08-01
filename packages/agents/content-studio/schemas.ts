import type { z } from "zod";
import { contentStudio } from "../roster.js";

export const inputSchema = contentStudio.input;
export const outputSchema = contentStudio.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
