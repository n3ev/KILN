import type { z } from "zod";
import { storefrontEngineer } from "../roster.js";

export const inputSchema = storefrontEngineer.input;
export const outputSchema = storefrontEngineer.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
