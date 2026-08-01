// TODO(prompt-2): implement live provisioning and provider credential rotation.
// TODO(prompt-4): implement live polling, webhook normalisation and reconciliation.
// TODO(prompt-5): move assembled envelopes to object storage and schedule delivery/lifecycle jobs.
import type {
  Connector,
  ConnectorProvider,
  EscrowScheduleReceipt,
  EscrowScheduleRequest,
  EscrowScheduler,
  ReconciliationBatch,
  ReconciliationRequest,
  RotationPolicy,
  RotationRequest,
} from "./types.js";

export class LiveConnectorUnavailable extends Error {
  constructor(provider: string, capability: string, prompt: 2 | 4 | 5) {
    super(`Live ${provider} ${capability} is unavailable in prompt 1; TODO(prompt-${prompt})`);
    this.name = "LiveConnectorUnavailable";
  }
}

/**
 * TODO(prompt-2): replace provisioning and credential rotation methods with
 * provider SDK adapters. TODO(prompt-4): implement live mirror polling.
 */
export class LiveConnectorStub implements Connector {
  readonly mode = "live" as const;

  constructor(
    readonly provider: ConnectorProvider,
    readonly rotation: RotationPolicy,
  ) {}

  async reconcile(_request: ReconciliationRequest): Promise<ReconciliationBatch> {
    throw new LiveConnectorUnavailable(this.provider, "mirror reconciliation", 4);
  }

  async issueRotationCredential(_request: RotationRequest): Promise<string> {
    throw new LiveConnectorUnavailable(this.provider, "credential rotation", 2);
  }

  async verifyRotationCredential(_secret: string, _request: RotationRequest): Promise<boolean> {
    throw new LiveConnectorUnavailable(this.provider, "credential verification", 2);
  }
}

/** Assembly and recipient-only encryption ship in prompt 1; prompt 5 schedules storage and delivery. */
export class LiveEscrowSchedulerStub implements EscrowScheduler {
  readonly mode = "live" as const;

  async schedule(_request: EscrowScheduleRequest): Promise<EscrowScheduleReceipt> {
    throw new LiveConnectorUnavailable("escrow", "packet scheduling", 5);
  }
}
