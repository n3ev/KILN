import type { z } from "zod";
import { productArchitect } from "../roster.js";

export const inputSchema = productArchitect.input;
export const outputSchema = productArchitect.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
