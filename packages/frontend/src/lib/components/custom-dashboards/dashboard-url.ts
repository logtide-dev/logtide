// ============================================================================
// Dashboard URL state: `?id=<uuid>&range=<preset>`
// ============================================================================
//
// Pure helpers. Dashboards support preset ranges only, so `from` / `to` are
// ignored on read and left untouched on write.

import { PANEL_TIME_RANGES } from '@logtide/shared';
import type { PanelTimeRange } from '@logtide/shared';

export type DashboardUrlState = {
  id: string | null;
  range: PanelTimeRange | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readDashboardUrlState(url: URL): DashboardUrlState {
  const rawId = url.searchParams.get('id');
  const rawRange = url.searchParams.get('range');
  const id = rawId && UUID_RE.test(rawId) ? rawId : null;
  const range =
    rawRange && (PANEL_TIME_RANGES as readonly string[]).includes(rawRange)
      ? (rawRange as PanelTimeRange)
      : null;
  return { id, range };
}

/** Returns a new URL; a null value removes its key, other params are kept. */
export function writeDashboardUrlState(url: URL, state: DashboardUrlState): URL {
  const next = new URL(url.toString());
  if (state.id) next.searchParams.set('id', state.id);
  else next.searchParams.delete('id');
  if (state.range) next.searchParams.set('range', state.range);
  else next.searchParams.delete('range');
  return next;
}
