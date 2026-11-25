// ============================================================================
// Dashboard variables in the URL: `var-<name>=<value>`
// ============================================================================
//
// An empty value means "All" (null). A name absent from the URL keeps the
// variable's default. Pure helpers, other params are left untouched.

import { DASHBOARD_VARIABLE_NAME_RE } from '@logtide/shared';
import type { DashboardVariable } from '@logtide/shared';

const VAR_PREFIX = 'var-';

/** Values present in the URL, for names that look like variable names. */
export function readVariableValues(url: URL): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (!key.startsWith(VAR_PREFIX)) continue;
    const name = key.slice(VAR_PREFIX.length);
    if (!DASHBOARD_VARIABLE_NAME_RE.test(name)) continue;
    out[name] = value === '' ? null : value;
  }
  return out;
}

/** A new URL with one var-<name> per variable that differs from its default; other var-* removed. */
export function writeVariableValues(
  url: URL,
  variables: DashboardVariable[],
  values: Record<string, string | null>
): URL {
  const next = new URL(url.toString());
  for (const key of Array.from(next.searchParams.keys())) {
    if (key.startsWith(VAR_PREFIX)) next.searchParams.delete(key);
  }
  for (const v of variables) {
    const value = values[v.name] ?? null;
    if (value !== v.default) next.searchParams.set(`${VAR_PREFIX}${v.name}`, value ?? '');
  }
  return next;
}
