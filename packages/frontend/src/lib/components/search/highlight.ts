import type { SearchMode } from '$lib/api/logs';

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Split text into segments, marking the parts that match the full-text query.
// Rendered as plain text segments (no {@html}), so it never injects markup.
export function highlightSegments(
  text: string,
  query: string,
  mode: SearchMode,
): { text: string; match: boolean }[] {
  const value = text ?? '';
  if (!value || !query || mode !== 'fulltext') return [{ text: value, match: false }];
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [{ text: value, match: false }];
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const lower = new Set(terms.map((t) => t.toLowerCase()));
  return value
    .split(re)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: lower.has(part.toLowerCase()) }));
}
