/**
 * @kiln/contracts — the single source of truth for every type in KILN.
 *
 * Zod schemas are authored here; TypeScript types are inferred from them; DB
 * columns and JSON boundaries derive from them. Nothing in this package may
 * import from another @kiln package, which is what keeps it importable from
 * the browser, the worker, the MCP server, and the migration scripts alike.
 */

export * from "./primitives.js";
export * from "./sources.js";
export * from "./errors.js";
export * from "./scopes.js";
export * from "./metrics.js";
export * from "./entitlements.js";

// Artifact payload contracts, in run order.
export * from "./brief.js";
export * from "./validation.js";
export * from "./strategy.js";
export * from "./brand.js";
export * from "./catalogue.js";
export * from "./supply.js";
export * from "./storefront.js";
export * from "./content.js";
export * from "./growth.js";
export * from "./compliance.js";
export * from "./critique.js";
export * from "./quality.js";
export * from "./operate.js";
export * from "./handover.js";

// Structural contracts.
export * from "./artifact.js";
export * from "./run.js";
