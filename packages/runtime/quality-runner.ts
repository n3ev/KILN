import {
  ComplianceReport,
  ContentSet,
  failedAssertions,
  PolicySet,
  ProductCatalogue,
  QualityReport,
  StorefrontBuild,
  UnitEconomicsModel,
  type QualityReport as QualityReportValue,
} from "@kiln/contracts";
import type { Playbook } from "@kiln/playbooks";
import { evaluateGates, type GateInput } from "@kiln/quality";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";
import { runtimeNow } from "./tracking.js";

function parsed<T>(schema: { safeParse(value: unknown): { success: boolean; data?: T } }, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

export async function evaluatePlaybookQuality(
  deps: OrchestratorDeps,
  run: RunContextState,
  playbook: Playbook,
): Promise<QualityReportValue> {
  const evidence = (await deps.qualityEvidence?.(run)) ?? {};
  const artifacts = run.artifacts;
  const input: GateInput = {
    catalogue: parsed(ProductCatalogue, artifacts["product_catalogue"]),
    content: parsed(ContentSet, artifacts["content_set"]),
    storefront: parsed(StorefrontBuild, artifacts["storefront_build"]),
    policies: parsed(PolicySet, artifacts["policy_set"]),
    compliance: parsed(ComplianceReport, artifacts["compliance_report"]),
    economics: parsed(UnitEconomicsModel, artifacts["unit_economics"]),
    ...(evidence.probes ? { probes: evidence.probes } : {}),
    ...(evidence.negativeMarginAcknowledged !== undefined
      ? { negativeMarginAcknowledged: evidence.negativeMarginAcknowledged }
      : {}),
  };

  const evaluatedAt = runtimeNow(deps);
  const results = evaluateGates(playbook.qualityGates, input).map((result) => ({
    ...result,
    evaluatedAt,
  }));
  return QualityReport.parse({
    results,
    clearedForLaunch: results.every((result) => result.passed || result.overridden),
    hasOverrides: results.some((result) => result.overridden),
    evaluatedAt,
  });
}

export function qualityFailures(report: QualityReportValue) {
  return failedAssertions(report);
}
