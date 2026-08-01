import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { closeDb } from "@kiln/db";
import { logger } from "@kiln/observability";
import { createDefaultWorkerRuntime } from "../bootstrap.js";
import { runPoller } from "../poller.js";

export async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals) => {
    logger.info("worker shutdown requested", { signal });
    controller.abort(signal);
  };
  const onSigterm = () => stop("SIGTERM");
  const onSigint = () => stop("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  try {
    const runtime = createDefaultWorkerRuntime(controller.signal);
    logger.info("worker started", { pollIntervalMs: runtime.pollIntervalMs });
    await runPoller({ ...runtime, signal: controller.signal });
    logger.info("worker stopped cleanly");
  } finally {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
    await closeDb();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void main().catch((error: unknown) => {
    logger.error("worker terminated", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
