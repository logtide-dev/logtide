// Text query conformance (plan D3): words match whole tokens of the message
// case-insensitively in any script, phrases are case-insensitive substrings,
// OR groups and exclusions combine with AND. Every `q` goes through the
// grammar and `mergeCompiledSearch`, the path the logs API and alerts use.
// The only accepted engine difference is TimescaleDB English stemming
// (`timescaleMayAlsoMatch`, spec 5.3).

import { describe } from 'vitest';
import type { ConformanceContext, LogCase } from '../harness.js';
import { runLogCases } from '../harness.js';
import { logsExcept } from '../corpus.js';

export const TEXT_QUERY_CASES: LogCase[] = [
  { id: 'T01', title: 'a word matches every case of it', q: 'timeout', expected: ['L03', 'L04', 'L19'] },
  { id: 'T02', title: 'a word does not match longer words', q: 'connection', expected: ['L02'], timescaleMayAlsoMatch: ['L04', 'L06'] },
  { id: 'T03', title: 'a quoted phrase', q: '"connection refused"', expected: ['L02'] },
  { id: 'T04', title: 'phrases are case-insensitive', q: '"CONNECTION REFUSED"', expected: ['L02'] },
  { id: 'T05', title: 'a phrase matches inside words', q: '"conn"', expected: ['L02', 'L04', 'L06'] },
  { id: 'T06', title: 'OR between words', q: 'timeout OR refused', expected: ['L02', 'L03', 'L04', 'L19'] },
  { id: 'T07', title: 'an OR group ANDs with the next word', q: 'timeout OR refused db', expected: ['L02'] },
  { id: 'T08', title: 'an excluded word', q: '-timeout', expected: logsExcept('L03', 'L04', 'L19') },
  { id: 'T09', title: 'a word and an excluded word', q: 'payment -failed', expected: ['L15'] },
  { id: 'T10', title: 'Cyrillic words fold case', q: 'ошибка', expected: ['L08', 'L22'] },
  { id: 'T11', title: 'accented words fold case', q: 'ÉCHOUÉ', expected: ['L09'] },
  { id: 'T12', title: 'a CJK word must be a whole token', q: '東京', expected: [] },
  { id: 'T13', title: 'a CJK phrase matches inside a token', q: '"東京"', expected: ['L10'] },
  { id: 'T14', title: 'underscores belong to words', q: 'user_id', expected: ['L11'] },
  { id: 'T15', title: 'a word is not a prefix match', q: 'user', expected: ['L01'], timescaleMayAlsoMatch: ['L12'] },
  { id: 'T16', title: 'English stop words still match', q: 'not', expected: ['L11'] },
  { id: 'T17', title: 'the article "the" still matches', q: 'the', expected: ['L18'] },
  { id: 'T18', title: 'a token inside a dotted host name', q: 'example', expected: ['L20'] },
  { id: 'T19', title: 'an IP address is a phrase', q: '10.0.0.1', expected: ['L13'] },
  { id: 'T20', title: 'a URL path is a phrase', q: '/api/v1/users', expected: ['L12'] },
  { id: 'T21', title: 'letters and digits form one word', q: '12ms', expected: ['L12'] },
  { id: 'T22', title: 'a word inside a hyphenated word', q: 'error', expected: ['L21'] },
  { id: 'T23', title: 'a hyphenated word is a phrase', q: 'error-prone', expected: ['L21'] },
  { id: 'T24', title: 'a quoted word is a phrase', q: '"failed"', expected: ['L14', 'L20'] },
  { id: 'T25', title: 'a word stem does not match', q: 'fail', expected: [], timescaleMayAlsoMatch: ['L14', 'L20'] },
  { id: 'T26', title: 'an OR group with an excluded word', q: 'timeout OR refused -db', expected: ['L03', 'L04', 'L19'] },
  { id: 'T27', title: 'a three-way OR', q: 'alice OR fox OR redis', expected: ['L01', 'L04', 'L18'] },
  { id: 'T28', title: 'two OR groups AND together', q: 'timeout OR refused upstream OR redis', expected: ['L02', 'L04'] },
  { id: 'T29', title: 'a phrase with punctuation', q: '"failed: card"', expected: ['L14'] },
  { id: 'T30', title: 'a bare word ending in a colon is text', q: 'Job finished: 12', expected: ['L05'] },
  { id: 'T31', title: 'an excluded phrase and an excluded word', q: '-"connection refused" -timeout', expected: logsExcept('L02', 'L03', 'L04', 'L19') },
  { id: 'T32', title: 'an explicit AND', q: 'payment AND succeeded', expected: ['L15'] },
  { id: 'T33', title: 'lowercase or is a word', q: 'timeout or refused', expected: [] },
  { id: 'T34', title: 'an excluded dotted phrase', q: '-"api.example.com"', expected: logsExcept('L20') },
  { id: 'T35', title: 'a Cyrillic phrase folds case', q: '"ошибка ПОВТОРИЛАСЬ"', expected: ['L22'] },
];

export function describeTextQueryConformance(ctx: ConformanceContext): void {
  describe('text query', () => {
    runLogCases(ctx, TEXT_QUERY_CASES);
  });
}
