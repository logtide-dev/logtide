import type { Monitor } from '$lib/api/monitoring';
import type { StatusPageComponentInput, StatusPageConfig } from '$lib/api/status-page';
import { contrastRatio } from './contrast';

export interface BrandingDraft {
  title: string;
  description: string;
  logoUrl: string;
  accentColor: string;
  showMonitorTypes: boolean;
}

export interface ComponentRow {
  monitorId: string;
  name: string;
  displayName: string;
  groupName: string;
}

export function draftFromConfig(config: StatusPageConfig): BrandingDraft {
  return {
    title: config.title ?? '',
    description: config.description ?? '',
    logoUrl: config.logoUrl ?? '',
    accentColor: config.accentColor ?? '',
    showMonitorTypes: config.showMonitorTypes,
  };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function configFromDraft(draft: BrandingDraft): StatusPageConfig {
  return {
    title: nullable(draft.title),
    description: nullable(draft.description),
    logoUrl: nullable(draft.logoUrl),
    accentColor: nullable(draft.accentColor),
    showMonitorTypes: draft.showMonitorTypes,
  };
}

/** Per-field messages, an empty object when the draft can be saved. */
export function validateBranding(draft: BrandingDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.title.trim().length > 120) errors.title = 'Use at most 120 characters';
  if (draft.description.trim().length > 500) errors.description = 'Use at most 500 characters';

  const logo = draft.logoUrl.trim();
  if (logo) {
    let ok = false;
    if (logo.length <= 2048) {
      try {
        const url = new URL(logo);
        ok = url.protocol === 'https:' && !url.username && !url.password;
      } catch {
        ok = false;
      }
    }
    if (!ok) errors.logoUrl = 'Use an https:// image URL without credentials';
  }

  const accent = draft.accentColor.trim();
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    errors.accentColor = 'Use a colour like #2563eb';
  }
  return errors;
}

/** A pale accent is hard to see on the white page; flag it without blocking the save. */
export function accentContrastWarning(accent: string): string | null {
  const ratio = contrastRatio(accent.trim(), '#ffffff');
  if (ratio === null || ratio >= 3) return null;
  return 'This colour is very light and may be hard to see on a white page';
}

/** Public order: display order first, then creation time. */
export function rowsFromMonitors(monitors: Monitor[]): ComponentRow[] {
  return [...monitors]
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    .map((m) => ({
      monitorId: m.id,
      name: m.name,
      displayName: m.displayName ?? '',
      groupName: m.groupName ?? '',
    }));
}

export function moveRow(rows: ComponentRow[], index: number, delta: -1 | 1): ComponentRow[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Order is renumbered 0..n-1 from the current row sequence. */
export function componentsPayload(rows: ComponentRow[]): StatusPageComponentInput[] {
  return rows.map((row, order) => ({
    monitorId: row.monitorId,
    displayName: nullable(row.displayName),
    groupName: nullable(row.groupName),
    order,
  }));
}
