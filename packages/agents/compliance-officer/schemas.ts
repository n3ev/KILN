import type { z } from "zod";
import { complianceOfficer } from "../roster.js";

export const inputSchema = complianceOfficer.input;
export const outputSchema = complianceOfficer.output;
export type AgentInput = z.input<typeof inputSchema>;
export type AgentOutput = z.output<typeof outputSchema>;
