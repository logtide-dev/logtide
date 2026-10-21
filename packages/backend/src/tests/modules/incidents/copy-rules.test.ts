/**
 * Copy rules (spec section 3) on the files the incidents work owns: no em
 * dash or en dash anywhere, and API error strings (shown in toasts) in
 * sentence case, without "successfully" or a trailing exclamation mark.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const FILES = [
  'src/modules/incidents/routes.ts',
  'src/modules/incidents/service.ts',
  'src/modules/incidents/types.ts',
  'src/modules/incidents/status.ts',
  'src/modules/incidents/actor.ts',
  'src/modules/incidents/mappers.ts',
  'src/modules/incidents/query-params.ts',
  'src/modules/incidents/index.ts',
  'src/modules/siem/routes.ts',
  'src/modules/siem/sse-events.ts',
  'src/modules/siem/dashboard-service.ts',
  'migrations/062_incidents_generalization.sql',
  '../shared/src/types/incident.ts',
];

/** Capitalized words allowed after the first word (acronyms and product names). */
const ALLOWED = new Set(['SSE', 'SIEM', 'GeoIP', 'IP', 'MITRE', 'Sigma']);

function read(file: string): string {
  return readFileSync(resolve(BACKEND_ROOT, file), 'utf8');
}

/** A single, double or backtick quoted literal, captured in group 2. */
const LITERAL = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`;

const MESSAGE_PATTERNS = [
  // `{ error: '...' }` response bodies.
  new RegExp(String.raw`\berror:\s*` + LITERAL, 'g'),
  // `new IncidentError('code', '...')`.
  new RegExp(String.raw`new IncidentError\(\s*'[a-z_]+'\s*,\s*` + LITERAL, 'g'),
  // `handleError(error, request, reply, '...')`: the fallback is sent as `{ error }`.
  new RegExp(String.raw`handleError\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*` + LITERAL, 'g'),
];

function errorMessages(): { file: string; message: string }[] {
  const out: { file: string; message: string }[] = [];
  for (const file of FILES.filter((f) => f.endsWith('.ts'))) {
    const source = read(file);
    for (const pattern of MESSAGE_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        out.push({ file, message: match[2] });
      }
    }
  }
  return out;
}

describe('incident copy rules', () => {
  it('contains no em dash or en dash', () => {
    for (const f of FILES) {
      expect({ file: f, hasDash: /[\u2014\u2013]/.test(read(f)) }).toEqual({ file: f, hasDash: false });
    }
  });

  it('finds the error messages it checks', () => {
    const messages = errorMessages().map((m) => m.message);
    expect(messages).toContain('Incident not found');
    expect(messages).toContain('Assignee is not a member of this organization');
    expect(messages).toContain('Failed to list incidents');
    expect(messages).toContain('Invalid or expired stream ticket');
  });

  it('error messages are sentence case without "successfully" or a trailing "!"', () => {
    const offending = errorMessages().filter(({ message }) => {
      const capitalizedLater = message
        .split(' ')
        .slice(1)
        .filter((w) => /^[A-Z][a-z]/.test(w) && !ALLOWED.has(w));
      return !/^[A-Z]/.test(message) || /successfully|!$/i.test(message) || capitalizedLater.length > 0;
    });
    expect(offending).toEqual([]);
  });
});
