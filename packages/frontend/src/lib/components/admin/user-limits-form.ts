import type { UserLimitOverride } from '$lib/api/admin';

export type LimitMode = 'default' | 'custom' | 'unlimited';

/** One limit as edited in the form: a mode and, for custom, the typed number. */
export interface LimitField {
  mode: LimitMode;
  text: string | number;
}

export const MAX_USER_LIMIT = 100000;

export function limitFieldFromOverride(override: UserLimitOverride): LimitField {
  if (override === 'default') return { mode: 'default', text: '' };
  if (override === 'unlimited') return { mode: 'unlimited', text: '' };
  return { mode: 'custom', text: String(override) };
}

/** The override a field stands for, or null when a custom value is not a valid limit. */
export function limitFieldToOverride(field: LimitField): UserLimitOverride | null {
  if (field.mode === 'default') return 'default';
  if (field.mode === 'unlimited') return 'unlimited';
  const text = String(field.text ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_USER_LIMIT ? value : null;
}

/** A limit as text: the number, or "no limit" for null. */
export function limitText(limit: number | null): string {
  return limit === null ? 'no limit' : limit.toLocaleString('en-US');
}
