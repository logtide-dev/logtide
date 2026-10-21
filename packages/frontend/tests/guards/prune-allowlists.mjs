// Usage (from packages/frontend):
//   node tests/guards/prune-allowlists.mjs          drop allowlist entries that no longer offend
//   node tests/guards/prune-allowlists.mjs --init   write the current offenders (first run only)
// The allowlists are shrink-only: pruning never adds a file once initialised.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ALLOWLIST_DIR, RULES } from './detectors.mjs';

const init = process.argv.includes('--init');

const HEADER = (rule) =>
  `# Ratchet allowlist for the ${rule} guard. Shrink-only: delete lines for files you fixed, never add one.\n`;

mkdirSync(ALLOWLIST_DIR, { recursive: true });

for (const [rule, scan] of Object.entries(RULES)) {
  const file = path.join(ALLOWLIST_DIR, `${rule}.txt`);
  const offenders = scan();
  let keep;
  if (init) {
    keep = offenders;
  } else {
    const current = existsSync(file)
      ? readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
      : [];
    keep = current.filter((f) => offenders.includes(f));
    const dropped = current.length - keep.length;
    if (dropped > 0) console.log(`${rule}: dropped ${dropped} stale entr${dropped === 1 ? 'y' : 'ies'}`);
  }
  writeFileSync(file, HEADER(rule) + keep.join('\n') + (keep.length ? '\n' : ''));
  console.log(`${rule}: ${keep.length} allowlisted`);
}
