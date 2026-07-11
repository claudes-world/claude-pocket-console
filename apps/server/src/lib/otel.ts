import fs from 'node:fs/promises';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import { context, trace, metrics, type Tracer, type Span, SpanStatusCode, type Meter, type ObservableResult } from '@opentelemetry/api';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'cpc-server',
  [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env['NODE_ENV'] ?? 'production',
});

// ── Traces ────────────────────────────────────────────────────────────────────
// Sampling: default to 10% of root traces — the previous always-on default
// combined with per-call spans (isPathAllowed, db statements) could overflow
// BatchSpanProcessor's buffer under load, silently dropping spans. The env
// var OTEL_TRACES_SAMPLE_RATE lets ops tune (0.0–1.0). Wrapping in
// ParentBasedSampler honors upstream sampling decisions — if Alloy or another
// caller propagates a sampled trace, we inherit that decision instead of
// re-rolling and potentially breaking a trace mid-flight.
const sampleRateEnv = process.env['OTEL_TRACES_SAMPLE_RATE'];
const parsed = sampleRateEnv !== undefined ? parseFloat(sampleRateEnv) : NaN;
const sampleRate = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.1;
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(sampleRate),
});
const provider = new NodeTracerProvider({ resource, sampler });

// OTLPTraceExporter silently drops spans when the collector is absent — no process crash.
// Use BatchSpanProcessor in prod (non-blocking buffer flush) and SimpleSpanProcessor in dev.
const otlpExporter = new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' });
provider.addSpanProcessor(
  process.env['NODE_ENV'] === 'development'
    ? new SimpleSpanProcessor(otlpExporter)
    : new BatchSpanProcessor(otlpExporter)
);

if (process.env['NODE_ENV'] === 'development') {
  provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
}

provider.register();

// ── Metrics ───────────────────────────────────────────────────────────────────
// OTLPMetricExporter silently drops metrics when the collector is absent — no process crash.
const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: 'http://localhost:4318/v1/metrics' }),
      exportIntervalMillis: 60_000,
    }),
  ],
});

metrics.setGlobalMeterProvider(meterProvider);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Signal ownership belongs to index.ts, which can drain its HTTP and WebSocket
// servers before flushing the final request-completion telemetry.
export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([provider.shutdown(), meterProvider.shutdown()]);
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

export function getMeter(name: string): Meter {
  return metrics.getMeter(name);
}

/**
 * Register an ObservableGauge that reports the SQLite DB file size in bytes.
 * Called once from index.ts after the db path is resolved.
 * Silent no-op if stat fails (file not yet created or permission error).
 */
export function registerDbSizeGauge(dbPath: string): void {
  const m = getMeter('db');
  const gauge = m.createObservableGauge('db_size_bytes', {
    description: 'SQLite database file size in bytes',
    unit: 'bytes',
  });
  gauge.addCallback(async (result: ObservableResult) => {
    try {
      const stat = await fs.stat(dbPath);
      result.observe(stat.size);
    } catch {
      // File absent or unreadable — skip observation (no-op is safe)
    }
  });
}

// Convenience wrapper — every span must be paired with span.end()
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (err) {
    span.recordException(err instanceof Error ? err : String(err));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}
