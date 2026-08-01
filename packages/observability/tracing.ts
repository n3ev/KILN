import { randomUUID } from "node:crypto";
import { config } from "@kiln/config";
import { logger } from "./logger.js";
import { redact } from "./redaction.js";

/**
 * Minimal tracing with an OpenTelemetry-shaped surface.
 *
 * Deliberately not importing the OTel SDK yet: it is a large dependency whose
 * only job here would be to print to the console, which this does in twenty
 * lines. `exportSpan` is the seam — point it at an OTLP exporter in prod and
 * nothing above it changes. See CLAUDE.md §4.
 */

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

export interface Span extends SpanContext {
  readonly name: string;
  readonly startedAt: number;
  attributes: Record<string, unknown>;
  setAttribute(key: string, value: unknown): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface FinishedSpan extends SpanContext {
  readonly name: string;
  readonly durationMs: number;
  readonly attributes: Record<string, unknown>;
  readonly error?: { name: string; message: string };
}

type Exporter = (span: FinishedSpan) => void;

let exporter: Exporter = (span) => {
  logger.debug(`span ${span.name}`, {
    traceId: span.traceId,
    durationMs: span.durationMs,
    ...span.attributes,
  });
};

/** Swap in an OTLP exporter at process start. */
export function setSpanExporter(next: Exporter): void {
  exporter = next;
}

export function startSpan(name: string, parent?: SpanContext, attributes: Record<string, unknown> = {}): Span {
  const traceId = parent?.traceId ?? randomUUID();
  const spanId = randomUUID();
  const startedAt = performance.now();
  let error: { name: string; message: string } | undefined;
  let ended = false;

  const span: Span = {
    traceId,
    spanId,
    ...(parent?.spanId !== undefined ? { parentSpanId: parent.spanId } : {}),
    name,
    startedAt,
    attributes: { ...attributes },
    setAttribute(key, value) {
      span.attributes[key] = value;
    },
    recordError(e) {
      error = e instanceof Error ? { name: e.name, message: e.message } : { name: "Unknown", message: String(e) };
    },
    end() {
      // Double-ending a span silently doubles your latency histogram, which is
      // the kind of bug that survives for months.
      if (ended) return;
      ended = true;
      exporter({
        traceId,
        spanId,
        ...(parent?.spanId !== undefined ? { parentSpanId: parent.spanId } : {}),
        name,
        durationMs: performance.now() - startedAt,
        attributes: redact(span.attributes),
        ...(error ? { error } : {}),
      });
    },
  };
  return span;
}

/** Wraps an async function in a span that ends on both paths. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  parent?: SpanContext,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  const span = startSpan(name, parent, attributes);
  try {
    return await fn(span);
  } catch (error) {
    span.recordError(error);
    throw error;
  } finally {
    span.end();
  }
}

export function tracingTarget(): string {
  return config().OTEL_EXPORTER_OTLP_ENDPOINT ?? "console";
}
