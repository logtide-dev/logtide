import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Ratchet: no in-app reference to the pre-1.6 routes. Old URLs are only
// allowed in the redirect handlers and the tests that pin them.
const OLD_ROUTE = /\/dashboard(?:\/|\\\/)(search|monitoring)\b/;

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests'];

const ALLOWLIST = new Set([
  'src/lib/utils/legacy-routes.ts',
  'src/lib/utils/legacy-routes.test.ts',
  'src/routes/dashboard/search/+server.ts',
  'src/routes/dashboard/monitoring/+server.ts',
  'src/routes/dashboard/monitoring/[id]/+server.ts',
  'tests/route-redirects.spec.ts',
  'src/lib/routes-sweep.test.ts',
]);

const EXTENSIONS = new Set(['.ts', '.svelte', '.js']);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.svelte-kit' || name === 'build') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) out.push(full);
  }
}

describe('route sweep guard', () => {
  it('has no references to /dashboard/search or /dashboard/monitoring outside the redirects', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (ALLOWLIST.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (OLD_ROUTE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
