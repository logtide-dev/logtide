import {
  isTimeRangePreset,
  timeRangePresetToMs,
  type TimeRangePreset,
} from '@logtide/shared';

// Pure scope helpers: URL parsing and writing, range resolution, reconcile
// logic and legacy store mapping. No `$app` imports so everything here is unit
// tested without mocks. The persisted store lives in scope.ts.

export type TimeRangeValue =
  | { kind: 'preset'; preset: TimeRangePreset }
  | { kind: 'custom'; from: string; to: string };

export interface Scope {
  /** Empty means all projects the user can see. */
  projectIds: string[];
  range: TimeRangeValue;
}

/** URL value of `project` that means "all projects" (an empty list cannot be written). */
export const ALL_PROJECTS = 'all';

export const DEFAULT_RANGE: TimeRangeValue = { kind: 'preset', preset: '24h' };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;

function parseIso(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string') return null;
  // An unencoded "+" in a query string arrives as a space; restore it.
  const text = raw.trim().replace(/\s(\d{2}(:?\d{2})?)$/, '+$1');
  if (!ISO_RE.test(text)) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseIdList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(',')) {
      const id = part.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function customFrom(fromRaw: unknown, toRaw: unknown): TimeRangeValue | null {
  const from = parseIso(typeof fromRaw === 'string' ? fromRaw : null);
  const to = parseIso(typeof toRaw === 'string' ? toRaw : null);
  if (!from || !to || from.getTime() >= to.getTime()) return null;
  return { kind: 'custom', from: from.toISOString(), to: to.toISOString() };
}

export function readScopeFromUrl(url: URL): Partial<Scope> {
  const result: Partial<Scope> = {};
  const p = url.searchParams;

  // On a create-alert link `projectId` means "pre-fill the project" (spec 5.10),
  // never scope.
  const prefillLink = p.get('create') === '1' || p.get('new') === '1';
  const projectValues = p.has('project')
    ? p.getAll('project')
    : prefillLink
      ? []
      : p.getAll('projectId');
  const all = parseIdList(projectValues);
  const ids = all.filter((id) => id !== ALL_PROJECTS);
  if (ids.length > 0) result.projectIds = ids;
  // `project=all` is an explicit "all projects", so a link can override the
  // viewer's remembered project.
  else if (all.length > 0) result.projectIds = [];

  const range = p.get('range');
  if (range !== null && isTimeRangePreset(range)) {
    result.range = { kind: 'preset', preset: range };
  } else {
    const custom = customFrom(p.get('from'), p.get('to'));
    if (custom) result.range = custom;
  }
  return result;
}

export interface WriteScopeOptions {
  /** Write `project=all` for an empty selection instead of leaving `project` out. */
  explicitAll?: boolean;
}

/**
 * Drops the legacy `projectId` scope param, which would otherwise be re-read
 * and override a later "All projects" choice. Kept on log links (`logId`) and
 * on create-alert links, where it has another meaning.
 */
export function stripLegacyProject(url: URL): URL {
  const p = url.searchParams;
  if (!p.has('projectId')) return url;
  if (p.has('logId') || p.get('create') === '1' || p.get('new') === '1') return url;
  const next = new URL(url.href);
  next.searchParams.delete('projectId');
  return next;
}

export function writeScopeToUrl(
  url: URL,
  scope: Partial<Scope>,
  options: WriteScopeOptions = {}
): URL {
  const next = new URL(url.href);
  const p = next.searchParams;
  if (scope.range) {
    if (scope.range.kind === 'preset') {
      p.set('range', scope.range.preset);
      p.delete('from');
      p.delete('to');
    } else {
      p.set('from', scope.range.from);
      p.set('to', scope.range.to);
      p.delete('range');
    }
  }
  if (scope.projectIds) {
    if (scope.projectIds.length > 0) p.set('project', scope.projectIds.join(','));
    else if (options.explicitAll) p.set('project', ALL_PROJECTS);
    else p.delete('project');
  }
  return next;
}

export function resolveRange(
  range: TimeRangeValue,
  now: Date = new Date()
): { from: Date; to: Date } {
  if (range.kind === 'preset') {
    return { from: new Date(now.getTime() - timeRangePresetToMs(range.preset)), to: now };
  }
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.getTime() >= to.getTime()
  ) {
    return { from: new Date(now.getTime() - timeRangePresetToMs('24h')), to: now };
  }
  return { from, to };
}

export function rangesEqual(a: TimeRangeValue, b: TimeRangeValue): boolean {
  if (a.kind === 'preset' && b.kind === 'preset') return a.preset === b.preset;
  if (a.kind === 'custom' && b.kind === 'custom') return a.from === b.from && a.to === b.to;
  return false;
}

export function sanitizeRange(raw: unknown): TimeRangeValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'preset') {
    return isTimeRangePreset(r.preset) ? { kind: 'preset', preset: r.preset } : null;
  }
  if (r.kind === 'custom') return customFrom(r.from, r.to);
  return null;
}

export function sanitizeScope(raw: unknown): Scope | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.projectIds)) return null;
  if (!r.projectIds.every((id) => typeof id === 'string')) return null;
  const range = sanitizeRange(r.range);
  if (!range) return null;
  const projectIds = parseIdList(r.projectIds as string[]);
  return { projectIds, range };
}

// ─── Legacy store mapping ───────────────────────────────────────────────────

const LEGACY_TO_PRESET: Record<string, TimeRangePreset> = {
  last_hour: '1h',
  last_24h: '24h',
  last_7d: '7d',
};
const PRESET_TO_LEGACY: Record<string, string> = {
  '1h': 'last_hour',
  '24h': 'last_24h',
  '7d': 'last_7d',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function legacyTimeRangeToRange(v: {
  type: string;
  from: string;
  to: string;
}): TimeRangeValue | null {
  if (!v || typeof v.type !== 'string') return null;
  const mapped = LEGACY_TO_PRESET[v.type];
  if (mapped) return { kind: 'preset', preset: mapped };
  if (isTimeRangePreset(v.type)) return { kind: 'preset', preset: v.type };
  if (v.type === 'custom') {
    // Legacy custom strings are browser-local YYYY-MM-DDTHH:mm.
    if (typeof v.from !== 'string' || typeof v.to !== 'string') return null;
    const from = new Date(v.from);
    const to = new Date(v.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    if (from.getTime() >= to.getTime()) return null;
    return { kind: 'custom', from: from.toISOString(), to: to.toISOString() };
  }
  return null;
}

export function rangeToLegacyTimeRange(r: TimeRangeValue): {
  type: string;
  from: string;
  to: string;
} {
  if (r.kind === 'custom') {
    return {
      type: 'custom',
      from: toLocalInput(new Date(r.from)),
      to: toLocalInput(new Date(r.to)),
    };
  }
  return { type: PRESET_TO_LEGACY[r.preset] ?? r.preset, from: '', to: '' };
}

// ─── Reconcile ──────────────────────────────────────────────────────────────

function rangeAllowed(range: TimeRangeValue, presets?: TimeRangePreset[]): boolean {
  if (!presets || presets.length === 0) return true;
  return range.kind === 'custom' || presets.includes(range.preset);
}

export function reconcileScope(input: {
  stored: Scope;
  url: URL;
  projects: { id: string }[];
  mode: 'multi' | 'single';
  presets?: TimeRangePreset[];
  /** Which scope parts the canonical URL carries (a bar may hide one). */
  write?: { projects?: boolean; range?: boolean };
}): { effective: Scope; commit: Scope; url: URL | null } {
  const { stored, url, projects, mode, presets } = input;
  const fromUrl = readScopeFromUrl(url);

  // `effective` is what this page shows and may fall back for this page only.
  // `commit` is what gets persisted: what the URL decided, otherwise the stored
  // value untouched. A page fallback is never persisted.
  let range: TimeRangeValue = fromUrl.range ?? stored.range;
  if (!rangeAllowed(range, presets)) {
    if (rangeAllowed(stored.range, presets)) range = stored.range;
    else if (rangeAllowed(DEFAULT_RANGE, presets)) range = DEFAULT_RANGE;
    else range = { kind: 'preset', preset: (presets as TimeRangePreset[])[0] };
  }

  const commitRange =
    fromUrl.range && rangeAllowed(fromUrl.range, presets) ? fromUrl.range : stored.range;

  // Projects
  const urlIds = fromUrl.projectIds;
  const merged = urlIds ?? stored.projectIds;
  const valid = new Set(projects.map((p) => p.id));
  let ids: string[];
  let commitIds: string[] = stored.projectIds;

  if (projects.length > 0) {
    if (mode === 'multi') {
      ids = merged.filter((id) => valid.has(id));
      if (ids.length === projects.length) ids = [];
      // A link whose ids are all foreign decides nothing.
      if (urlIds && (urlIds.length === 0 || urlIds.some((id) => valid.has(id)))) commitIds = ids;
    } else {
      const urlPick = urlIds?.find((id) => valid.has(id));
      const pick = urlPick ?? stored.projectIds.find((id) => valid.has(id)) ?? projects[0].id;
      ids = [pick];
      if (urlPick) commitIds = stored.projectIds[0] === pick ? stored.projectIds : ids;
    }
  } else if (mode === 'multi') {
    ids = merged;
    if (urlIds) commitIds = ids;
  } else {
    ids = merged.slice(0, 1);
    if (urlIds) {
      commitIds = ids.length > 0 && stored.projectIds[0] === ids[0] ? stored.projectIds : ids;
    }
  }

  const effective: Scope = { projectIds: ids, range };
  const commit: Scope = { projectIds: commitIds, range: commitRange };
  const parts: Partial<Scope> = {};
  if (input.write?.projects !== false) parts.projectIds = ids;
  if (input.write?.range !== false) parts.range = range;
  const written = stripLegacyProject(writeScopeToUrl(url, parts, { explicitAll: true }));
  const same = written.searchParams.toString() === url.searchParams.toString();
  return { effective, commit, url: same ? null : written };
}
