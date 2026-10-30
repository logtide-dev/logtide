import type { ProjectHealthIssue } from '@logtide/shared';
import { formatRelative } from '$lib/utils/datetime';

export interface IssueCopy {
  /** What happened, with the numbers from the issue details. */
  explanation: string;
  /** Short pointer to the fix. */
  hint: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralWord}`;
}

function hours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60)).toLocaleString('en-US')} minutes`;
  return plural(Math.round(h), 'hour');
}

/** "up to 3 hours in the past" / "up to 2 hours ahead of the server clock". */
function skewDirection(details: Record<string, unknown>): string {
  const past = num(details.maxPastHours) ?? 0;
  const future = num(details.maxFutureHours) ?? 0;
  if (past === 0 && future === 0) return 'out of range';
  return past >= future ? `up to ${hours(past)} in the past` : `up to ${hours(future)} ahead of the server clock`;
}

const SKEW_NOUN = {
  timestamp_skew_logs: 'log',
  timestamp_skew_spans: 'span',
  timestamp_skew_metrics: 'metric',
} as const;

/** Plain-language explanation of an issue, shared by every place that shows one. */
export function issueCopy(issue: Pick<ProjectHealthIssue, 'checkKey' | 'details'>): IssueCopy {
  const d = issue.details ?? {};
  switch (issue.checkKey) {
    case 'silent': {
      const last = typeof d.lastEventAt === 'string' ? formatRelative(d.lastEventAt) : null;
      const minutes = num(d.silentMinutes);
      return {
        explanation:
          `No logs, spans or metrics have arrived${last ? ` since ${last}` : ''}` +
          `${minutes ? ` (the alert threshold is ${plural(minutes, 'minute')})` : ''}.`,
        hint: 'Check that the shipper or SDK is still running and that its API key is valid.',
      };
    }
    case 'pii_rejected': {
      const count = num(d.count60m) ?? 0;
      return {
        explanation: `${plural(count, 'record')} ${count === 1 ? 'was' : 'were'} rejected by PII masking in the last hour, so ${count === 1 ? 'it was' : 'they were'} not stored.`,
        hint: 'Review the PII masking rules that reject records, or stop sending the sensitive field.',
      };
    }
    case 'revoked_key': {
      const count = num(d.count60m) ?? 0;
      return {
        explanation: `${plural(count, 'request')} used a revoked API key in the last hour. The data was refused.`,
        hint: 'Replace the revoked key in the shipper with an active one.',
      };
    }
    case 'timestamp_skew_logs': {
      const count = num(d.count24h) ?? 0;
      const noun = SKEW_NOUN.timestamp_skew_logs;
      return {
        explanation:
          `In the last 24 hours, ${plural(count, noun)} arrived with a timestamp ${skewDirection(d)}. ` +
          'They are stored and searchable, but threshold alert rules only count logs inside their time window, so these logs cannot trigger an alert.',
        hint: 'This usually means the shipper sends a time field that does not match the current instant. Omitting it makes LogTide use the server ingestion time.',
      };
    }
    case 'timestamp_skew_spans': {
      const count = num(d.count24h) ?? 0;
      return {
        explanation:
          `In the last 24 hours, ${plural(count, SKEW_NOUN.timestamp_skew_spans)} ended with a timestamp ${skewDirection(d)}. ` +
          'They are stored, but they fall outside the time windows trace views use, so these spans will not appear there for that period.',
        hint: 'This usually means a clock or exporter timestamp problem on the sending host.',
      };
    }
    case 'timestamp_skew_metrics': {
      const count = num(d.count24h) ?? 0;
      return {
        explanation:
          `In the last 24 hours, ${plural(count, SKEW_NOUN.timestamp_skew_metrics)} arrived with a timestamp ${skewDirection(d)}. ` +
          'They are stored, but dashboards only show data points inside their time window, so these metrics will not appear in dashboards for that period.',
        hint: 'This usually means a clock or exporter timestamp problem on the sending host.',
      };
    }
  }
}

/** True while a mute is in force. */
export function isMuted(issue: Pick<ProjectHealthIssue, 'mute'>, now: Date = new Date()): boolean {
  const m = issue.mute;
  if (!m) return false;
  if (m.untilResolved) return true;
  return m.until !== null && new Date(m.until).getTime() > now.getTime();
}
