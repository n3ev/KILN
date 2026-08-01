import type { AnyTool } from "../core/define.js";
import { ToolRegistry } from "../core/registry.js";
import { analyticsTools } from "./analytics/index.js";
import { bookingTools } from "./booking/index.js";
import { shopifyTools } from "./commerce.shopify/index.js";
import { stripeTools } from "./commerce.stripe/index.js";
import { complianceTools } from "./compliance/index.js";
import { commsTools } from "./comms/index.js";
import { contentTools } from "./content/index.js";
import { designTools } from "./design/index.js";
import { financeTools } from "./finance/index.js";
import { identityTools } from "./identity/index.js";
import { internalTools } from "./internal/index.js";
import { researchTools } from "./research/index.js";
import { siteTools } from "./site/index.js";
import { supplyTools } from "./supply/index.js";

/**
 * The catalogue.
 *
 * Registration is explicit rather than filesystem-scanned: a tool that reaches
 * production because a file happened to sit in a directory is a tool nobody
 * reviewed. Adding one means adding it to its domain's export list and, if the
 * domain is new, to the list below.
 */

export const ALL_TOOLS: readonly AnyTool[] = [
  ...researchTools,
  ...identityTools,
  ...designTools,
  ...shopifyTools,
  ...stripeTools,
  ...supplyTools,
  ...siteTools,
  ...contentTools,
  ...commsTools,
  ...bookingTools,
  ...analyticsTools,
  ...complianceTools,
  ...financeTools,
  ...internalTools,
];

export function buildRegistry(): ToolRegistry {
  return new ToolRegistry().registerAll(ALL_TOOLS);
}

/** Populates the process-wide registry. Called once at process start. */
export function registerCatalogue(registry: ToolRegistry): ToolRegistry {
  return registry.registerAll(ALL_TOOLS);
}

export * from "./research/index.js";
export * from "./identity/index.js";
export * from "./design/index.js";
export * from "./commerce.shopify/index.js";
export * from "./commerce.stripe/index.js";
export * from "./supply/index.js";
export * from "./site/index.js";
export * from "./content/index.js";
export * from "./comms/index.js";
export * from "./booking/index.js";
export * from "./analytics/index.js";
export * from "./compliance/index.js";
export * from "./finance/index.js";
export * from "./internal/index.js";
