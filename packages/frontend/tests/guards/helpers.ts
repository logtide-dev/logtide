import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
// @ts-ignore plain ESM shared with prune-allowlists.mjs
import { ALLOWLIST_DIR, listSourceFiles as list } from './detectors.mjs';

/** Recursive listing of files under src/, repo-relative with forward slashes, sorted. */
export function listSourceFiles(exts: string[]): string[] {
  return list(exts) as string[];
}

/** Lines of tests/guards/allowlists/<name>.txt without comments and blanks. */
export function readAllowlist(name: string): Set<string> {
  const file = path.join(ALLOWLIST_DIR as string, `${name}.txt`);
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) out.add(line);
  }
  return out;
}

/**
 * Fails when a file offends the rule and is not on the allowlist. Stale
 * allowlist entries (files that no longer offend) are only reported.
 */
export function assertRatchet(rule: string, offenders: string[], allowlist: Set<string>): void {
  const fresh = offenders.filter((f) => !allowlist.has(f));
  const stale = [...allowlist].filter((f) => !offenders.includes(f));
  if (stale.length > 0) {
    console.info(`[${rule}] stale allowlist entries, safe to delete:\n  ${stale.join('\n  ')}`);
  }
  expect(
    fresh,
    `[${rule}] new offenders (fix them, never add to the allowlist):\n  ${fresh.join('\n  ')}`
  ).toEqual([]);
}
