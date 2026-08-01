import {
  LiveEscrowSchedulerStub,
  MockEscrowScheduler,
  createConnectorRegistry,
  type ConnectorRegistry,
  type EscrowScheduler,
  type RotationRequest,
} from "@kiln/connectors";
import { processStripeEvent } from "@kiln/billing";
import { config } from "@kiln/config";
import { PostgresJobQueue, type JobHandler, type JobQueue } from "@kiln/jobs";
import { MirrorReconciler, PostgresMirrorStore } from "@kiln/mirror";
import { rotate as rotateCredential } from "@kiln/vault";
import {
  createJobHandlers,
  type CredentialRotationService,
  type EscrowSchedulingService,
} from "./jobs.js";
import { PostgresRunExecutor } from "./run-adapter.js";

class VaultCredentialRotationService implements CredentialRotationService {
  constructor(
    readonly connectors: ConnectorRegistry,
    readonly sandbox: boolean,
  ) {}

  async rotate(request: RotationRequest): Promise<{ rotated: boolean; reason?: string }> {
    const connector = this.connectors.resolve(request.provider, this.sandbox);
    if (connector.rotation === "manual") {
      return { rotated: false, reason: `${request.provider} requires manual rotation` };
    }
    return rotateCredential({
      credentialId: request.credentialId,
      provider: request.provider,
      accountId: request.accountId,
      issue: () => connector.issueRotationCredential(request),
      verify: (secret) => connector.verifyRotationCredential(secret, request),
    });
  }
}

class ConnectorEscrowSchedulingService implements EscrowSchedulingService {
  constructor(readonly scheduler: EscrowScheduler) {}

  schedule: EscrowSchedulingService["schedule"] = (request) => this.scheduler.schedule(request);
}

export interface DefaultWorkerRuntime {
  readonly queue: JobQueue;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly pollIntervalMs: number;
}

export function createDefaultWorkerRuntime(signal?: AbortSignal): DefaultWorkerRuntime {
  const cfg = config();
  const queue = new PostgresJobQueue({ workerId: `kiln-worker-${process.pid}` });
  const connectors = createConnectorRegistry();
  const mirror = new MirrorReconciler({
    connectors,
    store: new PostgresMirrorStore(),
    sandbox: cfg.sandbox,
  });
  const services = {
    run: new PostgresRunExecutor({ signal }),
    mirror,
    rotation: new VaultCredentialRotationService(connectors, cfg.sandbox),
    escrow: new ConnectorEscrowSchedulingService(
      cfg.sandbox ? new MockEscrowScheduler() : new LiveEscrowSchedulerStub(),
    ),
    billing: { process: (eventId: string) => processStripeEvent(eventId) },
  };
  return {
    queue,
    handlers: createJobHandlers({ queue, services }),
    pollIntervalMs: cfg.WORKER_POLL_MS,
  };
}
