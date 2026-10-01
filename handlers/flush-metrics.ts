import { createHandler, useMediator } from "../cqrs";
import { mergeBuckets, type PendingMetricBucket } from "../domain/analytics";
import type { MetricRepository } from "../repos/metric.repo";

export interface FlushMetricsInput {
   entries: PendingMetricBucket[];
}

export interface FlushMetricsOutput {
   flushed: number;
}

export function flushMetricsCommand(input: FlushMetricsInput) {
   return { _type: "command" as const, requestName: "FlushMetrics", payload: input };
}

/** Merge drained in-process buckets into the shared hourly aggregates. */
export function createFlushMetricsHandler(repo: MetricRepository) {
   return createHandler<FlushMetricsInput, FlushMetricsOutput>("FlushMetrics", async ({ entries }) => {
      for (const { kind, hour, bucket } of entries) {
         const current = await repo.get(kind, hour) ?? {};
         await repo.save(kind, hour, mergeBuckets(current, bucket));
      }
      return { success: true, data: { flushed: entries.length } };
   });
}

export function registerFlushMetrics(repo: MetricRepository) {
   useMediator().registerCommand(createFlushMetricsHandler(repo));
}
