/** Aggregated latency and outcome counters for one metric key within one hour. */
export interface MetricStat {
   count: number;
   errors: number;
   totalMs: number;
   maxMs: number;
   statuses: Record<string, number>;
}

export type MetricBucket = Record<string, MetricStat>;
/** routes: HTTP route shapes; cqrs: mediator requests; users: owner ids; tasks: Nitro tasks. */
export const METRIC_KINDS = ["routes", "cqrs", "users", "tasks"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export interface MetricSample {
   durationMs: number;
   ok: boolean;
   status?: number;
}

export interface MetricSummary extends MetricStat {
   key: string;
   avgMs: number;
   errorRate: number;
}

export interface HourlyTotal {
   hour: string;
   count: number;
   errors: number;
   avgMs: number;
}

const HOUR_MS = 3_600_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** UTC hour bucket id such as `2026-09-27T13`; free of storage key separators. */
export function hourKey(at: Date | number): string {
   return new Date(at).toISOString().slice(0, 13);
}

/** Hour bucket ids for the trailing window, newest first. */
export function recentHourKeys(hours: number, now = Date.now()): string[] {
   return Array.from({ length: hours }, (_, index) => hourKey(now - index * HOUR_MS));
}

function isDynamicSegment(raw: string): boolean {
   let segment = raw;
   try { segment = decodeURIComponent(raw); } catch { /* keep the raw segment */ }
   return /^\d+$/.test(segment)
      || UUID.test(segment)
      || /^[0-9a-f]{16,}$/i.test(segment)
      || /^(?:clerk:)?[a-z]+_[A-Za-z0-9]{12,}$/.test(segment);
}

/** Collapse ids in a concrete path so metrics group by route shape, not by record. */
export function normalizeRoutePath(pathname: string): string {
   const path = pathname.split("?")[0] || "/";
   return path.split("/").map(segment => isDynamicSegment(segment) ? ":id" : segment).join("/") || "/";
}

const emptyStat = (): MetricStat => ({ count: 0, errors: 0, totalMs: 0, maxMs: 0, statuses: {} });

export function recordSample(bucket: MetricBucket, key: string, sample: MetricSample): void {
   const stat = bucket[key] ??= emptyStat();
   stat.count += 1;
   if (!sample.ok) stat.errors += 1;
   stat.totalMs += sample.durationMs;
   stat.maxMs = Math.max(stat.maxMs, sample.durationMs);
   if (sample.status !== undefined) {
      const status = String(sample.status);
      stat.statuses[status] = (stat.statuses[status] ?? 0) + 1;
   }
}

export function mergeBuckets(target: MetricBucket, source: MetricBucket): MetricBucket {
   for (const [key, stat] of Object.entries(source)) {
      const into = target[key] ??= emptyStat();
      into.count += stat.count;
      into.errors += stat.errors;
      into.totalMs += stat.totalMs;
      into.maxMs = Math.max(into.maxMs, stat.maxMs);
      for (const [status, count] of Object.entries(stat.statuses ?? {})) {
         into.statuses[status] = (into.statuses[status] ?? 0) + count;
      }
   }
   return target;
}

/** Per-key totals across buckets, busiest first. */
export function summarizeBuckets(buckets: MetricBucket[]): MetricSummary[] {
   const merged = buckets.reduce<MetricBucket>((acc, bucket) => mergeBuckets(acc, bucket), {});
   return Object.entries(merged)
      .map(([key, stat]) => ({
         key,
         ...stat,
         avgMs: stat.count ? stat.totalMs / stat.count : 0,
         errorRate: stat.count ? stat.errors / stat.count : 0,
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/** One point per hour, oldest first, for traffic charts. */
export function hourlyTotals(entries: Array<{ hour: string; bucket: MetricBucket }>): HourlyTotal[] {
   return entries
      .map(({ hour, bucket }) => {
         const stats = Object.values(bucket);
         const count = stats.reduce((sum, stat) => sum + stat.count, 0);
         const totalMs = stats.reduce((sum, stat) => sum + stat.totalMs, 0);
         return {
            hour,
            count,
            errors: stats.reduce((sum, stat) => sum + stat.errors, 0),
            avgMs: count ? totalMs / count : 0,
         };
      })
      .sort((left, right) => left.hour.localeCompare(right.hour));
}
