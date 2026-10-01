import type { MetricBucket, MetricKind } from "../domain/analytics";

/** Shared storage key for one metric kind and UTC hour, read by Ruxt and Ruxt Admin. */
export const metricStorageKey = (kind: MetricKind, hour: string) => `${kind}:${hour}`;

export interface MetricRepository {
   get(kind: MetricKind, hour: string): Promise<MetricBucket | null>;
   save(kind: MetricKind, hour: string, bucket: MetricBucket): Promise<void>;
}
