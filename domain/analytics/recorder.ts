import { hourKey, recordSample, type MetricBucket, type MetricKind, type MetricSample } from "./metric";

export interface PendingMetricBucket {
   kind: MetricKind;
   hour: string;
   bucket: MetricBucket;
}

/** In-process accumulator; producers drain it periodically into shared storage. */
export class MetricsRecorder {
   private pending = new Map<string, PendingMetricBucket>();

   record(kind: MetricKind, key: string, sample: MetricSample, at: number = Date.now()): void {
      const hour = hourKey(at);
      const id = `${kind}:${hour}`;
      let entry = this.pending.get(id);
      if (!entry) {
         entry = { kind, hour, bucket: {} };
         this.pending.set(id, entry);
      }
      recordSample(entry.bucket, key, sample);
   }

   drain(): PendingMetricBucket[] {
      const entries = [...this.pending.values()];
      this.pending.clear();
      return entries;
   }
}
