import { can, grantedScopes } from "@kiln/billing";
import { Scope, type Autonomy, type Scope as ScopeValue } from "@kiln/contracts";

export interface ResolveRunGrantsInput {
  readonly accountId: string;
  readonly entitlements: unknown;
  readonly playbookId: string;
  readonly autonomy: Autonomy;
  readonly requiredScopes: readonly ScopeValue[];
}

/** Uses billing's single enforcement point, then returns only the intersection. */
export function resolveRunGrants(input: ResolveRunGrantsInput): ScopeValue[] {
  const account = { entitlements: input.entitlements };
  if (!can(account, "playbooks.allowed", input.playbookId)) {
    throw new Error(`Account ${input.accountId} is not entitled to playbook ${input.playbookId}`);
  }
  if (!can(account, "autonomy.max", input.autonomy)) {
    throw new Error(`Account ${input.accountId} is not entitled to ${input.autonomy} autonomy`);
  }
  return Scope.array().parse(grantedScopes(account, input.requiredScopes));
}
