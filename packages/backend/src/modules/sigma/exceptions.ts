import type { ExceptionCondition } from '@logtide/shared';
import { SigmaDetectionEngine, type LogEntry } from './detection-engine.js';

/**
 * Pure rule-exception matching. No DB access: callers load the exceptions
 * and pass them in.
 *
 * Every function here fails toward alerting: an expired exception is never
 * active, and a condition on a field the log does not carry never matches.
 */

export interface ActiveException {
  id: string;
  ruleId: string;
  conditions: ExceptionCondition[];
  expiresAt: Date | null;
}

export function isExceptionActive(e: { expiresAt: Date | null }, now: Date): boolean {
  return e.expiresAt === null || e.expiresAt.getTime() > now.getTime();
}

/** Comparable string forms of a field value, or null when it cannot match. */
function candidateStrings(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (item === undefined || item === null) continue;
    if (typeof item === 'object') continue;
    out.push(String(item).toLowerCase());
  }
  return out.length > 0 ? out : null;
}

function conditionMatches(flattened: Record<string, any>, cond: ExceptionCondition): boolean {
  const candidates = candidateStrings(flattened[cond.field]);
  if (!candidates) return false;

  const wanted = cond.values.map((v) => v.toLowerCase());
  switch (cond.operator) {
    case 'equals':
      return candidates.some((c) => c === wanted[0]);
    case 'contains':
      return wanted[0] !== undefined && candidates.some((c) => c.includes(wanted[0]));
    case 'in':
      return candidates.some((c) => wanted.includes(c));
    default:
      return false;
  }
}

/** All conditions are AND-ed. An exception without conditions never matches. */
export function matchesException(
  flattened: Record<string, any>,
  e: { conditions: ExceptionCondition[] }
): boolean {
  if (e.conditions.length === 0) return false;
  return e.conditions.every((cond) => conditionMatches(flattened, cond));
}

export interface PartitionableMatch {
  logIndex: number;
  sigmaRuleId: string;
}

/**
 * Split matches into kept ones and the per-exception count of suppressed
 * ones. A match is suppressed by the first active exception of its own rule
 * that matches its log.
 */
export function partitionMatches<M extends PartitionableMatch>(
  matches: M[],
  logs: LogEntry[],
  exceptions: Map<string, ActiveException[]> | ActiveException[],
  now: Date
): { kept: M[]; suppressed: Map<string, number> } {
  const byRule = new Map<string, ActiveException[]>();
  if (exceptions instanceof Map) {
    for (const [ruleId, list] of exceptions) byRule.set(ruleId, list);
  } else {
    for (const e of exceptions) {
      const list = byRule.get(e.ruleId) ?? [];
      list.push(e);
      byRule.set(e.ruleId, list);
    }
  }

  const kept: M[] = [];
  const suppressed = new Map<string, number>();
  const flatCache = new Map<number, Record<string, any>>();

  for (const match of matches) {
    const candidates = (byRule.get(match.sigmaRuleId) ?? []).filter((e) =>
      isExceptionActive(e, now)
    );
    if (candidates.length === 0) {
      kept.push(match);
      continue;
    }

    let flat = flatCache.get(match.logIndex);
    if (!flat) {
      flat = SigmaDetectionEngine.flatten(logs[match.logIndex]);
      flatCache.set(match.logIndex, flat);
    }
    const flatLog = flat;

    const hit = candidates.find((e) => matchesException(flatLog, e));
    if (hit) {
      suppressed.set(hit.id, (suppressed.get(hit.id) ?? 0) + 1);
    } else {
      kept.push(match);
    }
  }

  return { kept, suppressed };
}
