import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BasicTracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";

/**
 * Smoke + integration tests for the OTEL module.
 *
 *  - otel module smoke: import side-effects + getTracer shape.
 *  - tracedQuery: the REAL exported helper (formerly the test duplicated the
 *    function body inline, which meant future db.ts edits couldn't fail the
 *    test). We now import from db.ts directly so the test tracks reality.
 *  - DB proxy iterate / configurator coverage: exercises the fixes for
 *    phase-4 orch swarm HIGH findings H3 (iterate span lifecycle) and H4
 *    (pluck/raw return the raw Statement, bypassing tracing).
 *
 * We install an InMemorySpanExporter via a throwaway BasicTracerProvider
 * registered as the GLOBAL tracer provider BEFORE importing ../db.js or
 * ../lib/otel.js. That way the shipping code's `trace.getTracer(...)` calls
 * resolve to our in-memory provider, and we can inspect the spans that
 * actually flow through the real code paths.
 */

const memoryExporter = new InMemorySpanExporter();
const testProvider = new BasicTracerProvider();
testProvider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
// Register as the global provider BEFORE any code under test imports and
// calls getTracer. Once a tracer is vended from the global provider, it
// stays bound to it for the lifetime of that Tracer instance.
trace.setGlobalTracerProvider(testProvider);

describe("otel module", () => {
  it("imports without throwing", async () => {
    await expect(import("../lib/otel.js")).resolves.not.toThrow();
  });

  it("getTracer returns a tracer object", async () => {
    const { getTracer } = await import("../lib/otel.js");
    const tracer = getTracer("test-tracer");
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe("function");
  });
});

describe("tracedQuery (real export from db.ts)", () => {
  beforeAll(() => {
    memoryExporter.reset();
  });

  it("emits a db.<op> span and returns the callback result", async () => {
    memoryExporter.reset();
    const { tracedQuery } = await import("../db.js");

    const result = tracedQuery("SELECT", "transcripts", () => 42);
    expect(result).toBe(42);

    const spans = memoryExporter.getFinishedSpans();
    const match = spans.find((s: ReadableSpan) => s.name === "db.select");
    expect(match).toBeDefined();
    expect(match!.attributes["db.system"]).toBe("sqlite");
    expect(match!.attributes["db.operation"]).toBe("SELECT");
    expect(match!.attributes["db.sql.table"]).toBe("transcripts");
    // Non-error default status is UNSET (code 0), not ERROR (2).
    expect(match!.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("records exception and sets ERROR status when fn throws", async () => {
    memoryExporter.reset();
    const { tracedQuery } = await import("../db.js");

    const boom = new Error("db exploded");
    expect(() =>
      tracedQuery("INSERT", "transcripts", () => {
        throw boom;
      })
    ).toThrow("db exploded");

    const spans = memoryExporter.getFinishedSpans();
    const match = spans.find((s: ReadableSpan) => s.name === "db.insert");
    expect(match).toBeDefined();
    expect(match!.status.code).toBe(SpanStatusCode.ERROR);
    // recordException writes an "exception" event onto the span.
    expect(match!.events.some((e) => e.name === "exception")).toBe(true);
  });
});

describe("db Proxy tracing coverage", () => {
  let dbMod: typeof import("../db.js");

  beforeAll(async () => {
    dbMod = await import("../db.js");
  });

  afterAll(() => {
    // Best-effort: remove any rows this suite inserted to keep the
    // on-disk dev DB tidy. Harmless if rows already gone.
    try {
      dbMod.db
        .prepare("DELETE FROM transcripts WHERE user_id IN (?, ?)")
        .run("u-iter", "u-pluck");
    } catch {
      /* ignore */
    }
  });

  /**
   * H3: `.iterate()` must NOT end its span before the caller consumes the
   * iterator. Verify the span's duration spans the full consumption, not
   * just the synchronous iterate() setup.
   */
  it("iterate() span stays open across full consumption", () => {
    memoryExporter.reset();

    const id = `iter-${Date.now()}-${Math.random()}`;
    dbMod.db
      .prepare(
        `INSERT INTO transcripts (id, user_id, title, body, word_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, "u-iter", "t", "b", 1, Date.now(), Date.now());

    const stmt = dbMod.db.prepare("SELECT id FROM transcripts WHERE id = ?");
    const iter = (
      stmt as { iterate: (id: string) => IterableIterator<unknown> }
    ).iterate(id);

    // Before consumption, the iterate span is OPEN — no finished db.select
    // span should have appeared from the iterate call itself. (There will
    // be insert-related db.insert spans from setup; we filter for select.)
    const spansBeforeConsume = memoryExporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "db.select");
    expect(spansBeforeConsume.length).toBe(0);

    // Drain. Sleep briefly between consume and assertion to ensure the
    // SimpleSpanProcessor has processed the end.
    const rows = Array.from(iter);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const spansAfterConsume = memoryExporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "db.select");
    expect(spansAfterConsume.length).toBe(1);

    // Cleanup
    dbMod.db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
  });

  /**
   * H4: `.pluck()` must return a traced proxy, not the raw Statement.
   * Regression shape: if pluck returns the raw stmt, the chained .get() is
   * unproxied and emits zero spans.
   */
  it("pluck() chain still emits a db.select span on .get()", () => {
    const id = `pluck-${Date.now()}-${Math.random()}`;
    dbMod.db
      .prepare(
        `INSERT INTO transcripts (id, user_id, title, body, word_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, "u-pluck", "t", "b", 1, Date.now(), Date.now());

    memoryExporter.reset();

    const stmt = dbMod.db.prepare(
      "SELECT id FROM transcripts WHERE id = ?"
    );
    const plucked = (stmt as { pluck: () => typeof stmt }).pluck();
    const result = plucked.get(id);
    expect(result).toBe(id);

    const selects = memoryExporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "db.select");
    expect(selects.length).toBe(1);

    // Cleanup
    dbMod.db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
  });
});
