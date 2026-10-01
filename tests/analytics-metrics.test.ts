import { describe, expect, it } from "vitest";
import {
   MetricsRecorder,
   hourlyTotals,
   mergeBuckets,
   normalizeRoutePath,
   recordSample,
   recentHourKeys,
   summarizeBuckets,
   type MetricBucket,
   type MetricKind,
} from "../domain/analytics";
import { createFlushMetricsHandler } from "../handlers/flush-metrics";
import { createGetMetricReportHandler } from "../handlers/get-metric-report";
import { metricStorageKey, type MetricRepository } from "../repos/metric.repo";

function memoryMetrics() {
   const store = new Map<string, MetricBucket>();
   const repo: MetricRepository = {
      async get(kind: MetricKind, hour: string) { return store.get(metricStorageKey(kind, hour)) ?? null; },
      async save(kind: MetricKind, hour: string, bucket: MetricBucket) { store.set(metricStorageKey(kind, hour), bucket); },
   };
   return { store, repo };
}

describe("analytics metrics", () => {
   it("normalizes dynamic path segments without changing stable slugs", () => {
      expect(normalizeRoutePath("/api/cvs/8d9dc8eb-3021-4e33-8d75-87f8dadbd999?x=1")).toBe("/api/cvs/:id");
      expect(normalizeRoutePath("/api/jobs/123")).toBe("/api/jobs/:id");
      expect(normalizeRoutePath("/api/public/templates")).toBe("/api/public/templates");
   });

   it("merges and summarizes counters", () => {
      const first = {};
      recordSample(first, "GET /api/cvs", { durationMs: 10, ok: true, status: 200 });
      recordSample(first, "GET /api/cvs", { durationMs: 30, ok: false, status: 500 });
      const second = {};
      recordSample(second, "GET /api/cvs", { durationMs: 20, ok: true, status: 200 });

      expect(mergeBuckets(first, second)["GET /api/cvs"]).toMatchObject({
         count: 3, errors: 1, totalMs: 60, maxMs: 30, statuses: { "200": 2, "500": 1 },
      });
      expect(summarizeBuckets([first])[0]).toMatchObject({ avgMs: 20, errorRate: 1 / 3 });
   });

   it("drains process-local buckets and creates an oldest-first chart", () => {
      const recorder = new MetricsRecorder();
      recorder.record("routes", "GET /", { durationMs: 8, ok: true, status: 200 }, Date.UTC(2026, 0, 2, 3));
      recorder.record("routes", "GET /", { durationMs: 12, ok: false, status: 503 }, Date.UTC(2026, 0, 2, 3));
      const drained = recorder.drain();

      expect(drained).toHaveLength(1);
      expect(recorder.drain()).toEqual([]);
      expect(hourlyTotals(drained.map(({ hour, bucket }) => ({ hour, bucket })))).toEqual([
         { hour: "2026-01-02T03", count: 2, errors: 1, avgMs: 10 },
      ]);
      expect(recentHourKeys(2, Date.UTC(2026, 0, 2, 3))).toEqual(["2026-01-02T03", "2026-01-02T02"]);
   });

   it("flushes drained buckets into stored hourly aggregates", async () => {
      const { store, repo } = memoryMetrics();
      const at = Date.UTC(2026, 0, 2, 3);
      const flush = createFlushMetricsHandler(repo);
      const recorder = new MetricsRecorder();
      recorder.record("cqrs", "command SaveCvSource", { durationMs: 4, ok: true }, at);
      await expect(flush.execute({ entries: recorder.drain() })).resolves.toEqual({ success: true, data: { flushed: 1 } });
      recorder.record("cqrs", "command SaveCvSource", { durationMs: 6, ok: false }, at);
      await flush.execute({ entries: recorder.drain() });

      expect(store.get("cqrs:2026-01-02T03")?.["command SaveCvSource"]).toMatchObject({ count: 2, errors: 1, totalMs: 10, maxMs: 6 });
   });

   it("reports a trailing window with empty hours filled", async () => {
      const { repo } = memoryMetrics();
      const now = Date.UTC(2026, 0, 2, 3);
      const bucket: MetricBucket = {};
      recordSample(bucket, "GET /", { durationMs: 10, ok: true, status: 200 });
      await repo.save("routes", "2026-01-02T02", bucket);
      const report = createGetMetricReportHandler(repo);

      const result = await report.execute({ kind: "routes", hours: 2, now });
      expect(result).toMatchObject({ success: true });
      if (!result.success) return;
      expect(result.data.summary).toMatchObject([{ key: "GET /", count: 1, avgMs: 10 }]);
      expect(result.data.hourly).toEqual([
         { hour: "2026-01-02T02", count: 1, errors: 0, avgMs: 10 },
         { hour: "2026-01-02T03", count: 0, errors: 0, avgMs: 0 },
      ]);
      await expect(report.execute({ kind: "routes", hours: 0, now })).resolves.toMatchObject({ success: false });
   });
});
