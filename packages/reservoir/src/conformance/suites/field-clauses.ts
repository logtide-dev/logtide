// Field clause conformance (plan D1, D3): built-in fields compare exactly,
// exclusions keep logs that lack the field, metadata keys resolve like
// `resolveMetadataPath` (exact key beats dot path), numbers and booleans match
// by their text form, null exists but has no text, arrays never equal a
// scalar. Every `q` goes through the grammar and `mergeCompiledSearch`.

import { describe } from 'vitest';
import type { ConformanceContext, LogCase } from '../harness.js';
import { runLogCases } from '../harness.js';
import { PROJECT_A, PROJECT_B, S1, SESSION_IDS, T1, logsExcept, minutes } from '../corpus.js';

const NON_INFO = ['L02', 'L03', 'L04', 'L06', 'L07', 'L08', 'L09', 'L11', 'L14', 'L16', 'L19', 'L20', 'L22'];
const NOT_WEB_1 = ['L03', 'L04', 'L05', 'L07', 'L08', 'L09', 'L10', 'L13', 'L14', 'L15', 'L19', 'L20', 'L21', 'L25'];
const WEB_3 = ['L07', 'L08', 'L09', 'L10'];
const T1_LOGS = ['L16', 'L17'];

export const FIELD_CLAUSE_CASES: LogCase[] = [
  // Built-in fields
  { id: 'F01', title: 'a level', q: 'level:error', expected: ['L02', 'L04', 'L08', 'L14', 'L16', 'L20', 'L22'] },
  { id: 'F02', title: 'a level list', q: 'level:(warn OR critical)', expected: ['L03', 'L07', 'L09', 'L11', 'L19'] },
  { id: 'F03', title: 'an excluded level', q: '-level:info', expected: NON_INFO },
  { id: 'F04', title: 'an excluded level list', q: '-level:(info OR debug)', expected: NON_INFO.filter((id) => id !== 'L06') },
  { id: 'F05', title: 'a service', q: 'service:worker', expected: ['L04', 'L05'] },
  { id: 'F06', title: 'a service list', q: 'service:(auth OR billing)', expected: ['L08', 'L09', 'L10', 'L11', 'L14', 'L15'] },
  { id: 'F07', title: 'an excluded service', q: '-service:api', expected: ['L04', 'L05', 'L08', 'L09', 'L10', 'L11', 'L14', 'L15', 'L23', 'L24', 'L25'] },
  { id: 'F08', title: 'a host', q: 'host:web-3', expected: WEB_3 },
  { id: 'F08b', title: 'a host through the hostname alias', q: 'hostname:web-3', expected: WEB_3 },
  { id: 'F09', title: 'an excluded host keeps logs without a host', q: '-host:web-1', expected: NOT_WEB_1 },
  { id: 'F10', title: 'an excluded host list keeps logs without a host', q: '-host:(web-1 OR web-2)', expected: ['L05', 'L07', 'L08', 'L09', 'L10', 'L25'] },
  { id: 'F11', title: 'a trace id', q: `trace:${T1}`, expected: T1_LOGS },
  { id: 'F11b', title: 'a trace id through the trace_id alias', q: `trace_id:${T1}`, expected: T1_LOGS },
  { id: 'F12', title: 'a span id', q: `span:${S1}`, expected: ['L16'] },
  { id: 'F12b', title: 'a span id through the span_id alias', q: `span_id:${S1}`, expected: ['L16'] },
  { id: 'F13', title: 'a session id', q: `session:${SESSION_IDS.SESS1}`, expected: T1_LOGS },
  { id: 'F13b', title: 'a session id through the session_id alias', q: `session_id:${SESSION_IDS.SESS1}`, expected: T1_LOGS },
  { id: 'F14', title: 'built-in clauses AND together', q: 'service:api level:error -host:web-2', expected: ['L02', 'L16', 'L22'] },

  // Metadata keys
  { id: 'M01', title: 'a metadata value', q: 'env:staging', expected: ['L04', 'L05'] },
  { id: 'M02', title: 'an excluded metadata value keeps logs without the key', q: '-env:prod', expected: ['L04', 'L05', 'L25'] },
  { id: 'M03', title: 'a metadata value list', q: 'env:(staging OR dev)', expected: ['L04', 'L05'] },
  { id: 'M04', title: 'an excluded metadata value list keeps logs without the key', q: '-env:(prod OR staging)', expected: ['L25'] },
  { id: 'M05', title: 'a metadata key exists', q: 'env:*', expected: logsExcept('L25') },
  { id: 'M06', title: 'a metadata key does not exist', q: '-env:*', expected: ['L25'] },
  { id: 'M07', title: 'a number matches its text', q: 'status:500', expected: ['L02'] },
  { id: 'M08', title: 'a list of numbers', q: 'status:(200 OR 504)', expected: ['L01', 'L03', 'L12'] },
  { id: 'M09', title: 'contains on a number', q: 'status:*50*', expected: ['L02', 'L03'] },
  { id: 'M10', title: 'contains is case-insensitive', q: 'reason:*CARD*', expected: ['L14'] },
  { id: 'M11', title: 'a nested key', q: 'user.id:42', expected: ['L01'] },
  { id: 'M12', title: 'a literal dotted key', q: 'http.method:GET', expected: ['L02'] },
  { id: 'M13', title: 'a nested key with the same dotted name', q: 'http.method:POST', expected: ['L03'] },
  { id: 'M14', title: 'the literal dotted key wins over the nested path', q: 'geo.city:literal', expected: ['L23'] },
  { id: 'M15', title: 'a nested value hidden by a literal dotted key', q: 'geo.city:nested', expected: [] },
  { id: 'M16', title: 'a quoted nested value', q: 'geo.city:"Las Vegas"', expected: ['L24'] },
  { id: 'M17', title: 'false matches its text', q: 'ok:false', expected: ['L14'] },
  { id: 'M18', title: 'true matches its text', q: 'ok:true', expected: ['L15'] },
  { id: 'M19', title: 'a null value exists', q: 'note:*', expected: ['L14'] },
  { id: 'M20', title: 'a null value has no text', q: 'note:null', expected: [] },
  { id: 'M21', title: 'an array never equals a scalar', q: 'tags:a', expected: [] },
  { id: 'M22', title: 'a small number', q: 'retries:3', expected: ['L04'] },
  { id: 'M23', title: 'an object value exists', q: 'user:*', expected: ['L01'] },
  { id: 'M24', title: 'an excluded nested value keeps logs without the key', q: '-user.id:42', expected: logsExcept('L01') },
  { id: 'M25', title: 'a quoted value with slashes', q: 'disk.path:"/var/lib/data"', expected: ['L07'] },
  { id: 'M26', title: 'a number and a boolean together', q: 'amount:1999 ok:true', expected: ['L15'] },
  { id: 'M27', title: 'a metadata list and an excluded level', q: 'region:(eu OR ap) -level:error', expected: ['L09', 'L10'] },
  { id: 'M28', title: 'a dotted key does not exist (literal or nested)', q: '-geo.city:*', expected: logsExcept('L23', 'L24') },
  { id: 'M29', title: 'contains on a nested key', q: 'user.name:*ALI*', expected: ['L01'] },

  // Combinations, projects and windows
  { id: 'C01', title: 'a word and an excluded service', q: 'timeout -service:worker', expected: ['L03', 'L19'] },
  { id: 'C02', title: 'a word, a metadata value and an excluded boolean', q: 'payment env:prod -ok:true', expected: ['L14'] },
  { id: 'C03', title: 'a phrase over two projects', q: '"connection refused"', projectIds: [PROJECT_A, PROJECT_B], expected: ['L02', 'L90'] },
  { id: 'C04', title: 'a level inside a narrower window', q: 'level:error', window: { from: minutes(10), to: minutes(20) }, expected: ['L14', 'L16', 'L20'] },
  {
    id: 'C05', title: 'an exclusive window on both ends',
    window: { from: minutes(10), to: minutes(20), fromExclusive: true, toExclusive: true },
    expected: ['L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19'],
  },
];

export function describeFieldClauseConformance(ctx: ConformanceContext): void {
  describe('field clauses', () => {
    runLogCases(ctx, FIELD_CLAUSE_CASES);
  });
}
