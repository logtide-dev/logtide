import { writeScopeToUrl } from '$lib/stores/scope-url';

/** Pre-scoped link to a global page for one project (canonical `project` param). */
export function scopedHref(path: string, projectId: string): string {
  const url = writeScopeToUrl(new URL(path, 'http://local.invalid'), { projectIds: [projectId] });
  return `${url.pathname}${url.search}`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '-';
  if (ms >= 1000) return `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} s`;
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

export function formatPct(pct: number | null): string {
  if (pct === null) return '-';
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}
