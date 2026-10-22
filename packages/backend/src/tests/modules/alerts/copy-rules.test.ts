import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

/*
 * Spec section 3 copy rules on the files W8 owns (pure, no DB): no em or en
 * dash anywhere, user-facing strings without "successfully" or a trailing
 * "!", sentence case in-app titles and email subjects, en-US numbers.
 */

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const OWNED = [
  'src/modules/alerts',
  'src/queue/jobs/alert-notification.ts',
  'src/queue/jobs/alert-evaluation.ts',
  'src/tests/modules/alerts',
  'src/tests/queue/jobs/alert-notification.test.ts',
  'src/tests/queue/jobs/alert-evaluation.test.ts',
  'migrations/065_alert_rule_lifecycle.sql',
  '../shared/src/schemas/webhook-events.ts',
  '../../docs/webhooks.md',
];

/** Backend sources whose string literals reach users (API errors, notifications, incidents). */
const USER_FACING = [
  'src/queue/jobs/alert-notification.ts',
  'src/modules/alerts/routes.ts',
  'src/modules/alerts/incident-sync.ts',
  'src/modules/alerts/validation.ts',
  'src/modules/alerts/alert-query.ts',
  'src/modules/alerts/service.ts',
];

function abs(path: string): string {
  return resolve(BACKEND_ROOT, path);
}

function listFiles(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else {
      out.push(p);
    }
  };
  for (const p of paths) walk(abs(p));
  return out;
}

/**
 * String literals of a TypeScript source, comments skipped. Template
 * expressions are replaced by `${}` so only the fixed copy is checked.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          text += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
          }
          text += '${}';
          continue;
        }
        text += src[j];
        j++;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function functionSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const notificationSource = () => readFileSync(abs('src/queue/jobs/alert-notification.ts'), 'utf8');

describe('alert backend copy rules', () => {
  it('every owned path exists', () => {
    for (const p of OWNED) expect(existsSync(abs(p)), p).toBe(true);
  });

  it('owned files contain no em or en dash', () => {
    const files = listFiles(OWNED);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(DASHES.test(readFileSync(f, 'utf8')), f).toBe(false);
  });

  it('the literal scanner sees strings and skips comments', () => {
    const literals = stringLiterals(
      [
        "// it's a comment with 'quotes'",
        '/* another "one" */',
        "const a = 'Saved successfully';",
        'const b = `Rule ${name ? `x ${y}` : "z"} saved!`;',
        'const c = "plain";',
      ].join('\n')
    );
    expect(literals).toEqual(['Saved successfully', 'Rule ${} saved!', 'plain']);
  });

  it('owned user-facing strings avoid "successfully" and trailing "!"', () => {
    for (const file of USER_FACING) {
      const literals = stringLiterals(readFileSync(abs(file), 'utf8'));
      expect(literals.length, file).toBeGreaterThan(5);
      for (const text of literals) {
        expect(/successfully/i.test(text), `${file}: ${text}`).toBe(false);
        expect(text.trimEnd().endsWith('!'), `${file}: ${text}`).toBe(false);
      }
    }
  });

  it('in-app titles are sentence case', () => {
    const titles = stringLiterals(functionSource(notificationSource(), 'inAppCopy')).filter((t) =>
      t.endsWith(': ${}')
    );
    expect([...titles].sort()).toEqual([
      'Alert still firing: ${}',
      'Alert triggered: ${}',
      'Anomaly detected: ${}',
      'Anomaly still active: ${}',
    ]);
    for (const title of titles) expect(title).toMatch(/^[A-Z][a-z ]+: /);
  });

  it('the resolved webhook title is sentence case', () => {
    const resolved = stringLiterals(functionSource(notificationSource(), 'processResolvedNotification'));
    expect(resolved).toContain('Alert resolved: ${}');
  });

  it('email subjects are sentence case after the tag', () => {
    const subjects = stringLiterals(functionSource(notificationSource(), 'sendEmailNotification')).filter((t) =>
      /^\[(Alert|Anomaly)\] /.test(t)
    );
    expect(subjects).toHaveLength(4);
    for (const subject of subjects) {
      const words = subject
        .replace(/^\[(Alert|Anomaly)\] /, '')
        .replace(/\$\{\}/g, '')
        .split(/\s+/)
        .filter((w) => /[A-Za-z]/.test(w));
      for (const word of words.slice(1)) expect(word, subject).toMatch(/^[a-z]/);
    }
  });

  it('numbers in user-facing copy use en-US formatting', () => {
    for (const file of USER_FACING) {
      const src = readFileSync(abs(file), 'utf8');
      expect(/toLocaleString\(\s*\)/.test(src), file).toBe(false);
      expect(/toLocaleString\(\s*['"](?!en-US['"])/.test(src), file).toBe(false);
    }
  });
});
