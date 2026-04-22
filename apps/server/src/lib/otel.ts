import fs from 'node:fs/promises';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
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
const provider = new NodeTracerProvider({ resource });

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
// Flush buffered spans/metrics on process termination, then exit so the process
// doesn't hang on live handles (HTTP server socket, keep-alive connections).
// process.exit(0) is in `finally` so it runs even if a provider rejects (e.g.
// collector unavailable), preventing unhandled-rejection hangs on SIGTERM.
const shutdown = async (signal: string) => {
  // Hard-kill backstop: if flush stalls (e.g. collector network hang),
  // force-exit after 10s. unref() so it doesn't prevent normal exit itself.
  const hardKill = setTimeout(() => process.exit(1), 10_000);
  hardKill.unref();
  try {
    await provider.shutdown();
    await meterProvider.shutdown();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

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
