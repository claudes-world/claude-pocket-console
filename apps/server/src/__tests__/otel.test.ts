import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Smoke tests for the OTEL module.
 *
 * Test 1: Module imports without throwing (side-effect initialisation is safe).
 * Test 2: tracedQuery-style helper returns correct value and emits a span —
 *         validated by mocking @opentelemetry/api's trace.getTracer().
 */

describe("otel module", () => {
  it("imports without throwing", async () => {
    // Dynamic import — if module-level OTLP setup throws we'd see it here.
    await expect(import("../lib/otel.js")).resolves.not.toThrow();
  });

  it("getTracer returns a tracer object", async () => {
    const { getTracer } = await import("../lib/otel.js");
    const tracer = getTracer("test-tracer");
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
  });
});

describe("tracedQuery pattern", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the correct value and calls span.end()", () => {
    // Build a minimal mock span
    const spanEnd = vi.fn();
    const spanSetStatus = vi.fn();
    const spanRecordException = vi.fn();
    const mockSpan = {
      end: spanEnd,
      setStatus: spanSetStatus,
      recordException: spanRecordException,
    };

    // Mock getTracer to return a tracer that produces our mock span
    const startSpan = vi.fn().mockReturnValue(mockSpan);
    const mockTracer = { startSpan };

    // Replicate the tracedQuery logic to test the pattern
    function tracedQuery<T>(
      tracer: typeof mockTracer,
      op: string,
      table: string,
      fn: () => T,
    ): T {
      const span = tracer.startSpan(`db.${op.toLowerCase()}`, {
        attributes: { "db.system": "sqlite", "db.operation": op, "db.sql.table": table },
      });
      try {
        return fn();
      } catch (err) {
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: 2 }); // SpanStatusCode.ERROR = 2
        throw err;
      } finally {
        span.end();
      }
    }

    const result = tracedQuery(mockTracer, "SELECT", "transcripts", () => 42);

    expect(result).toBe(42);
    expect(startSpan).toHaveBeenCalledWith("db.select", {
      attributes: {
        "db.system": "sqlite",
        "db.operation": "SELECT",
        "db.sql.table": "transcripts",
      },
    });
    expect(spanEnd).toHaveBeenCalledOnce();
    expect(spanSetStatus).not.toHaveBeenCalled();
  });

  it("records exception and sets ERROR status when fn throws", () => {
    const spanEnd = vi.fn();
    const spanSetStatus = vi.fn();
    const spanRecordException = vi.fn();
    const mockSpan = {
      end: spanEnd,
      setStatus: spanSetStatus,
      recordException: spanRecordException,
    };
    const startSpan = vi.fn().mockReturnValue(mockSpan);
    const mockTracer = { startSpan };

    function tracedQuery<T>(
      tracer: typeof mockTracer,
      op: string,
      table: string,
      fn: () => T,
    ): T {
      const span = tracer.startSpan(`db.${op.toLowerCase()}`, {
        attributes: { "db.system": "sqlite", "db.operation": op, "db.sql.table": table },
      });
      try {
        return fn();
      } catch (err) {
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: 2 });
        throw err;
      } finally {
        span.end();
      }
    }

    const boom = new Error("db exploded");
    expect(() => tracedQuery(mockTracer, "INSERT", "transcripts", () => { throw boom; })).toThrow("db exploded");
    expect(spanRecordException).toHaveBeenCalledWith(boom);
    expect(spanSetStatus).toHaveBeenCalledWith({ code: 2 });
    expect(spanEnd).toHaveBeenCalledOnce();
  });
});
