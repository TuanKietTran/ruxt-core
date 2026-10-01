import { createHandler, useMediator } from "../cqrs";
import {
   hourlyTotals,
   recentHourKeys,
   summarizeBuckets,
   type HourlyTotal,
   type MetricKind,
   type MetricSummary,
} from "../domain/analytics";
import type { MetricRepository } from "../repos/metric.repo";

export interface GetMetricReportInput {
   kind: MetricKind;
   hours: number;
   now?: number;
}

export interface MetricReport {
   summary: MetricSummary[];
   hourly: HourlyTotal[];
}

export function getMetricReportQuery(input: GetMetricReportInput) {
   return { _type: "query" as const, requestName: "GetMetricReport", payload: input };
}

/** Per-key totals and an hourly series for the trailing window of one metric kind. */
export function createGetMetricReportHandler(repo: MetricRepository) {
   return createHandler<GetMetricReportInput, MetricReport>("GetMetricReport", async ({ kind, hours, now }) => {
      if (!Number.isInteger(hours) || hours < 1) throw new Error("Metric report window must be a positive number of hours");
      const entries = await Promise.all(recentHourKeys(hours, now).map(async (hour) => ({
         hour,
         bucket: await repo.get(kind, hour) ?? {},
      })));
      return {
         success: true,
         data: { summary: summarizeBuckets(entries.map((entry) => entry.bucket)), hourly: hourlyTotals(entries) },
      };
   });
}

export function registerGetMetricReport(repo: MetricRepository) {
   useMediator().registerQuery(createGetMetricReportHandler(repo));
}
