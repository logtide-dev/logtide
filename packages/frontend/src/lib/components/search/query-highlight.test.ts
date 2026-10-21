import { describe, it, expect } from 'vitest';
import { parseLogQuery, type LogSearchQuery } from '@logtide/shared';
import { tokenSegments, errorRange, messageHighlights } from './query-highlight';

function q(input: string): LogSearchQuery {
  const res = parseLogQuery(input);
  if (res.ok === false) throw new Error(res.error.message);
  return res.query;
}

function tokensOf(input: string) {
  return parseLogQuery(input).tokens;
}

function marked(message: string, query: LogSearchQuery | null): string[] {
  return messageHighlights(message, query)
    .filter((s) => s.match)
    .map((s) => s.text);
}

describe('tokenSegments', () => {
  it('covers the whole input with token and plain segments', () => {
    const input = 'level:error  timeout';
    const segments = tokenSegments(input, tokensOf(input));
    expect(segments.map((s) => s.text).join('')).toBe(input);
    expect(segments.map((s) => s.kind)).toEqual(['field', 'plain', 'word']);
    expect(segments.map((s) => s.start)).toEqual([0, 11, 13]);
  });

  it('keeps negation, operator and phrase tokens apart', () => {
    const input = '-debug a OR "b c"';
    const segments = tokenSegments(input, tokensOf(input));
    expect(segments.map((s) => s.text).join('')).toBe(input);
    expect(segments.filter((s) => s.kind !== 'plain').map((s) => [s.kind, s.text])).toEqual([
      ['negation', '-'],
      ['word', 'debug'],
      ['word', 'a'],
      ['operator', 'OR'],
      ['phrase', '"b c"'],
    ]);
  });

  it('returns plain text when there are no tokens', () => {
    expect(tokenSegments('  ', [])).toEqual([{ text: '  ', kind: 'plain', start: 0 }]);
    expect(tokenSegments('', [])).toEqual([]);
  });
});

describe('errorRange', () => {
  it('errorRange returns the token around the error position', () => {
    const input = 'timeout level:(a OR';
    const res = parseLogQuery(input);
    expect(res.ok).toBe(false);
    if (res.ok !== false) return;
    // The unclosed list starts at its parenthesis and runs to the end.
    expect(errorRange(input, res.tokens, res.error.position)).toEqual({ start: 8, end: input.length });
  });

  it('errorRange clamps a position at the end of the input', () => {
    expect(errorRange('abc', [], 3)).toEqual({ start: 2, end: 3 });
    const input = 'a OR';
    expect(errorRange(input, tokensOf(input), input.length)).toEqual({ start: 2, end: 4 });
  });

  it('falls back to one character outside any token', () => {
    expect(errorRange('a  b', [], 1)).toEqual({ start: 1, end: 2 });
    expect(errorRange('', [], 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('messageHighlights', () => {
  it('returns one plain segment without a query', () => {
    expect(messageHighlights('GET /health', null)).toEqual([{ text: 'GET /health', match: false }]);
  });

  it('marks whole words only', () => {
    const segments = messageHighlights('timeouts and timeout', q('timeout'));
    expect(segments).toEqual([
      { text: 'timeouts and ', match: false },
      { text: 'timeout', match: true },
    ]);
  });

  it('marks words case-insensitively and across any-of groups', () =>
    expect(marked('Timeout from DB, retry', q('timeout OR refused db'))).toEqual(['Timeout', 'DB']));

  it('marks phrases case-insensitively', () =>
    expect(marked('Connection Refused by peer', q('"connection refused"'))).toEqual(['Connection Refused']));

  it('never marks excluded terms or field values', () =>
    expect(marked('debug api', q('-debug service:api'))).toEqual([]));

  it('is safe with regex characters', () =>
    expect(marked('x a+b (c) y', q('"a+b (c)"'))).toEqual(['a+b (c)']));

  it('merges overlapping ranges', () =>
    expect(messageHighlights('connection refused', q('"connection ref" refused'))).toEqual([
      { text: 'connection refused', match: true },
    ]));

  it('matches non-ASCII words', () => expect(marked('Fehler: Zeitüberschreitung', q('zeitüberschreitung'))).toEqual(['Zeitüberschreitung']));
});
