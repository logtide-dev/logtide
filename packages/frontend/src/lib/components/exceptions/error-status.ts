import type { ErrorGroup, ErrorGroupStatus } from '@logtide/shared';
import { severityTone, stateTone, type Tone } from '$lib/utils/severity';
import { formatTimestamp } from '$lib/utils/datetime';

export function statusTone(status: ErrorGroupStatus): Tone {
  if (status === 'resolved') return stateTone('resolved');
  if (status === 'ignored') return stateTone('snoozed');
  return stateTone('open');
}

export function regressedTone(): Tone {
  return severityTone('medium');
}

/** One-line description of how a group is ignored, or null when it is not. */
export function describeIgnore(
  g: Pick<ErrorGroup, 'status' | 'ignoredUntil' | 'ignoreUntilCount' | 'ignoredEventCount'>
): string | null {
  if (g.status !== 'ignored') return null;

  const parts: string[] = [];
  if (g.ignoredUntil) {
    parts.push(formatTimestamp(g.ignoredUntil));
  }
  if (g.ignoreUntilCount != null) {
    const n = g.ignoreUntilCount;
    const so = (g.ignoredEventCount ?? 0).toLocaleString('en-US');
    parts.push(`${n.toLocaleString('en-US')} more event${n === 1 ? '' : 's'} (${so} so far)`);
  }
  if (parts.length === 0) return 'Ignored forever';
  return `Ignored until ${parts.join(' or ')}`;
}
