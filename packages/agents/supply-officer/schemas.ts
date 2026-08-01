import type { z } from "zod";
import { supplyOfficer } from "../roster.js";

export const inputSchema = supplyOfficer.input;
export const outputSchema = supplyOfficer.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
