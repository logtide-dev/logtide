import { db } from '../../database/index.js';
import { config } from '../../config/index.js';
import type { MeteringEvent } from './types.js';

export interface MeteringRecorderOptions {
  maxBuffer?: number;
  flushIntervalMs?: number;
  /** Hard ceiling above which new events are dropped (back-pressure safety). Defaults to maxBuffer * 10. */
  hardCap?: number;
}

/**
 * Non-blocking, loss-tolerant recorder. `record()` never awaits the DB.
 * Buffered events are batch-inserted on size threshold, on an interval, and on shutdown.
 * Metering is not audit: on flush failure or buffer overflow we drop and count.
 */
export class MeteringRecorder {
  private buffer: MeteringEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private dropped = 0;
  private readonly maxBuffer: number;
  private readonly flushIntervalMs: number;
  private readonly hardCap: number;

  constructor(opts: MeteringRecorderOptions = {}) {
    this.maxBuffer = opts.maxBuffer ?? config.METERING_FLUSH_MAX_BUFFER;
    this.flushIntervalMs = opts.flushIntervalMs ?? config.METERING_FLUSH_INTERVAL_MS;
    this.hardCap = opts.hardCap ?? this.maxBuffer * 10;
  }

  record(event: MeteringEvent): void {
    // METERING_ENABLED gates usage/resource metering (billing-shaped). The
    // `ingestion.*` types are operational health counters, not usage: they are
    // already excluded from tenant usage breakdowns by the `NOT LIKE
    // 'ingestion.%'` filter in breakdown.ts. A billing toggle must not be able
    // to silently blind operators to ingestion health (including the
    // pii_rejected safety counter), so those types bypass this gate. The
    // hardCap drop-guard below still applies: it is a memory safety valve,
    // not a feature toggle.
    if (!config.METERING_ENABLED && !event.type.startsWith('ingestion.')) return;
    if (this.buffer.length >= this.hardCap) {
      this.dropped++;
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBuffer) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await db
        .insertInto('metering_events')
        .values(
          batch.map((e) => ({
            time: e.time ?? new Date(),
            organization_id: e.organizationId,
            project_id: e.projectId ?? null,
            type: e.type,
            quantity: e.quantity,
            metadata: e.metadata ?? null,
          }))
        )
        .execute();
    } catch (err) {
      this.dropped += batch.length;
      console.error(`[Metering] Flush failed, dropped ${batch.length} event(s):`, err);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Don't keep the event loop alive just for metering flushes.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  get droppedCount(): number {
    return this.dropped;
  }

  get bufferSize(): number {
    return this.buffer.length;
  }
}
