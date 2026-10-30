import { formatRelative } from '$lib/utils/datetime';

export interface LastEventInput {
  lastEventAt: string | null | undefined;
  /** The project is listed in the logs, traces or metrics data availability. */
  receiving: boolean;
  now?: Date;
}

export interface LastEventStatus {
  kind: 'ago' | 'receiving' | 'waiting';
  text: string;
}

/**
 * Text for the "last event" line of a project card. `lastEventAt` is accurate
 * to about five minutes (it comes from the ingest-refreshed has_*_at flags).
 * A missing or unparseable date falls back to the data-availability answer, and
 * a date in the future (clock skew) is shown as "just now", never "in 3 minutes".
 */
export function describeLastEvent(input: LastEventInput): LastEventStatus {
  const now = input.now ?? new Date();
  if (input.lastEventAt) {
    const at = new Date(input.lastEventAt);
    if (!Number.isNaN(at.getTime())) {
      const clamped = at.getTime() > now.getTime() ? now : at;
      return { kind: 'ago', text: `Last event ${formatRelative(clamped, now)}` };
    }
  }
  if (input.receiving) return { kind: 'receiving', text: 'Receiving data' };
  return { kind: 'waiting', text: 'Waiting for data' };
}
