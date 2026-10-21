import { describe, it, expect } from 'vitest';
import { addFieldClause, removeFieldClause, quoteFieldValue } from './edit.js';
import { parseLogQuery } from './parser.js';

describe('addFieldClause', () => {
  it.each([
    ['', 'service', 'api', false, 'service:api'],
    ['timeout', 'service', 'api', false, 'timeout service:api'],
    ['timeout  service:web', 'service', 'api', false, 'timeout service:api'],
    ['service:api', 'service', 'api', true, '-service:api'],
    ['-service:api', 'service', 'api', false, 'service:api'],
    ['service:api', 'service', 'api', false, 'service:api'],
    ['env:prod', 'env', 'staging', false, 'env:staging'],
    ['env:prod', 'env', 'staging', true, 'env:prod -env:staging'],
    ['service:(a OR b)', 'service', 'a', true, 'service:b'],
    ['host:web-1', 'hostname', 'web-2', false, 'hostname:web-2'],
    ['timeout OR refused', 'service', 'api', false, 'timeout OR refused service:api'],
    ['x', 'msg', 'hello world', false, 'x msg:"hello world"'],
    ['x', 'k', 'say "hi" C:\\x', false, 'x k:"say \\"hi\\" C:\\\\x"'],
    ['x', 'k', '*', false, 'x k:"*"'],
    ['x', 'url', '//cdn', false, 'x url:"//cdn"'],
    ['x', 'ip', 'fe80::1', false, 'x ip:"fe80::1"'],
    ['x', 'bad key', 'v', false, 'x'],
  ])('addFieldClause(%j, %j, %j, %j)', (input, key, value, negate, expected) =>
    expect(addFieldClause(input, key, value, negate)).toBe(expected));

  it.each([
    // positive add drops the value from a negated list of the field
    ['-env:(a OR b)', 'env', 'a', false, '-env:b env:a'],
    ['-env:(a OR b OR c)', 'env', 'b', false, '-env:(a OR c) env:b'],
    // a positive add narrows to the value: other positive clauses of the field go
    ['service:(a OR b) x', 'service', 'a', false, 'x service:a'],
    ['service:a OR service:b x', 'service', 'c', false, 'x service:c'],
    // an identical clause stays where it is; conflicting ones still go
    ['service:api timeout', 'service', 'api', false, 'service:api timeout'],
    ['env:a env:b', 'env', 'a', false, 'env:a'],
    ['service:api -service:api', 'service', 'api', false, 'service:api'],
    ['host:web-1 x', 'hostname', 'web-1', false, 'host:web-1 x'],
    ['msg:"hello" x', 'msg', 'hello', false, 'msg:"hello" x'],
    // negated add: already excluded means unchanged
    ['-service:api x', 'service', 'api', true, '-service:api x'],
    ['-env:(a OR b)', 'env', 'b', true, '-env:(a OR b)'],
    ['-service:api service:api', 'service', 'api', true, '-service:api'],
    // negated add that narrows an OR chain of the field does not append
    ['service:a OR service:b', 'service', 'a', true, 'service:b'],
    ['service:(a)', 'service', 'a', true, '-service:a'],
    // level values compare case-insensitively, others exactly
    ['level:ERROR', 'level', 'error', false, 'level:ERROR'],
    ['-level:ERROR', 'level', 'error', false, 'level:error'],
    ['level:(warn OR ERROR)', 'level', 'error', true, 'level:warn'],
    ['service:API', 'service', 'api', false, 'service:api'],
    // exists, not_exists and contains clauses are left alone
    ['env:* env:*pro*', 'env', 'prod', false, 'env:* env:*pro* env:prod'],
    // byte-for-byte preservation outside touched clauses
    ['Foo  "a  b"   x', 'service', 'api', false, 'Foo  "a  b"   x service:api'],
    ['timeout ', 'service', 'api', false, 'timeout service:api'],
    ['a  service:x   b', 'service', 'y', false, 'a   b service:y'],
    ['a k:"v"b', 'k', 'w', false, 'a b k:w'],
    ['"a"service:x b', 'service', 'y', false, '"a" b service:y'],
    ['foo(bar) service:x', 'service', 'y', false, 'foo(bar) service:y'],
    // the key is used as passed
    ['', 'trace_id', 't1', false, 'trace_id:t1'],
  ])('edge: addFieldClause(%j, %j, %j, %j)', (input, key, value, negate, expected) =>
    expect(addFieldClause(input, key, value, negate)).toBe(expected));

  it('returns input unchanged when a quote is open', () => {
    expect(addFieldClause('"unclosed', 'service', 'api', false)).toBe('"unclosed');
    expect(removeFieldClause('"unclosed service:api', 'service')).toBe('"unclosed service:api');
  });

  it('returns input unchanged when a list is still open', () => {
    expect(addFieldClause('env:(a OR b', 'service', 'api', false)).toBe('env:(a OR b');
    expect(removeFieldClause('service:x env:(a', 'service')).toBe('service:x env:(a');
  });

  it('returns input unchanged when the input ends with a dangling OR or AND', () => {
    expect(addFieldClause('timeout OR', 'service', 'api', false)).toBe('timeout OR');
    expect(addFieldClause('timeout AND ', 'service', 'api', false)).toBe('timeout AND ');
  });

  it.each([
    ['timeout', 'service', 'api', false],
    ['timeout OR refused db', 'env', 'a b', true],
    ['service:(a OR b) -level:debug', 'level', 'warn', false],
    ['env:(a OR "b c")', 'env', 'b c', true],
    ['-env:(a OR b) user.id:*', 'env', 'a', false],
  ])('keeps a valid query valid: %j', (input, key, value, negate) => {
    expect(parseLogQuery(input).ok).toBe(true);
    const out = addFieldClause(input, key, value, negate);
    const r = parseLogQuery(out);
    expect(r.ok, `${out} -> ${r.ok ? '' : r.error.message}`).toBe(true);
  });
});

describe('quoteFieldValue', () => {
  it.each([
    ['a', 'a'],
    ['hello world', '"hello world"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['*', '"*"'],
    ['*x*', '"*x*"'],
    ['//x', '"//x"'],
  ])('quoteFieldValue(%j) is %j', (v, expected) => expect(quoteFieldValue(v)).toBe(expected));

  it.each([
    ['', '""'],
    ['x*', '"x*"'],
    ['a:b', '"a:b"'],
    ['(x)', '"(x)"'],
    ['C:\\x', '"C:\\\\x"'],
    ['a\\b', '"a\\\\b"'],
    ['tab\there', '"tab\there"'],
    ['nbsp\u00a0x', '"nbsp\u00a0x"'],
    ['/var/lib', '/var/lib'],
    ['é東', 'é東'],
    ['-x', '-x'],
    ['a*b', 'a*b'],
  ])('edge: quoteFieldValue(%j) is %j', (v, expected) => expect(quoteFieldValue(v)).toBe(expected));
});

describe('removeFieldClause', () => {
  it('removeFieldClause without a value drops every clause of the key, aliases included', () => {
    expect(removeFieldClause('a service:x -service:y service:(p OR q) b', 'service')).toBe('a b');
    expect(removeFieldClause('host:w1 -hostname:w2 x', 'host')).toBe('x');
    expect(removeFieldClause('trace_id:t1 x', 'trace')).toBe('x');
  });

  it.each([
    ['timeout service:api', 'service', undefined, 'timeout'],
    ['service:api timeout', 'service', undefined, 'timeout'],
    ['a service:api b', 'service', 'api', 'a b'],
    ['env:(a OR b OR c)', 'env', 'b', 'env:(a OR c)'],
    ['env:(a OR b)', 'env', 'a', 'env:b'],
    ['-env:prod x', 'env', undefined, 'x'],
    ['host:web-1', 'hostname', undefined, ''],
    ['timeout', 'service', undefined, 'timeout'],
    ['Foo  "a  b"   service:x', 'service', undefined, 'Foo  "a  b"'],
  ])('removeFieldClause(%j, %j, %j)', (input, key, value, expected) =>
    expect(removeFieldClause(input, key, value)).toBe(expected));

  it('removing one side of an OR chain removes the OR', () => {
    expect(removeFieldClause('service:a OR service:b', 'service', 'a')).toBe('service:b');
    expect(removeFieldClause('x service:a OR service:b', 'service', 'b')).toBe('x service:a');
  });

  it.each([
    // a single value left in a list keeps its literal meaning
    ['env:(* OR b)', 'env', 'b', 'env:"*"'],
    ['env:(*x* OR b)', 'env', 'b', 'env:"*x*"'],
    ['env:(//x OR b)', 'env', 'b', 'env:"//x"'],
    ['ab:(cd:ef OR x)', 'ab', 'x', 'ab:"cd:ef"'],
    ['env:("us east" OR eu)', 'env', 'eu', 'env:"us east"'],
    ['env:( "us east" OR eu OR x )', 'env', 'eu', 'env:("us east" OR x)'],
    ['-env:(a OR b OR c)', 'env', 'b', '-env:(a OR c)'],
    ['-env:(a OR b) x', 'env', 'a', '-env:b x'],
    ['env:(a OR a) x', 'env', 'a', 'x'],
    // a list glued to the next clause stays separated from it
    ['env:(a OR b)x', 'env', 'a', 'env:"b"x'],
    ['env:(a OR "b")x', 'env', 'a', 'env:"b"x'],
    // a value removes only value clauses with that literal value
    ['env:* env:"*" env:*x*', 'env', '*', 'env:* env:*x*'],
    ['env:*x* x', 'env', 'x', 'env:*x* x'],
    // without a value every clause of the field goes, exists and contains included
    ['user.id:* x -user.id:*42* -user.id:*', 'user.id', undefined, 'x'],
    // OR chains fully removed, and operators left dangling by a removal
    ['x service:a OR service:b y', 'service', undefined, 'x y'],
    ['a OR service:x OR b', 'service', undefined, 'a OR b'],
    ['service:api OR', 'service', undefined, ''],
    // level values compare case-insensitively
    ['level:(warn OR ERROR)', 'level', 'error', 'level:warn'],
    ['service:API', 'service', 'api', 'service:API'],
    // untouched text and error clauses survive
    ['service:a foo(bar)', 'service', undefined, 'foo(bar)'],
    ['"a"service:x b', 'service', undefined, '"a" b'],
    ['  service:x  ', 'service', undefined, '    '],
    ['x', 'bad key', undefined, 'x'],
    ['Level:x level:info', 'level', undefined, 'Level:x'],
  ])('edge: removeFieldClause(%j, %j, %j)', (input, key, value, expected) =>
    expect(removeFieldClause(input, key, value)).toBe(expected));
});

it.each(['a', 'hello world', 'say "hi"', 'C:\\x', '*', '*x*', 'x*', 'a:b', ':1', 'cd:ef', '//x', '(x)', 'OR', '-x', 'é東', ''])(
  'round-trips value %j', (v) => {
    for (const negate of [false, true]) {
      const r = parseLogQuery(addFieldClause('', 'ab', v, negate));
      expect(r.ok && r.query.fields).toEqual([{ field: { metadata: 'ab' }, op: negate ? 'not_equals' : 'equals', value: v }]);
    }
  });

it.each(['AND', '\\', '"', 'a b c', 'x"', 'k:v', 'a)', '\u00a0', 'fe80::1', 'aa:bb:cc:dd:ee:ff', '**', '***'])(
  'round-trips edge value %j', (v) => {
    for (const negate of [false, true]) {
      const r = parseLogQuery(addFieldClause('', 'ab', v, negate));
      expect(r.ok && r.query.fields).toEqual([{ field: { metadata: 'ab' }, op: negate ? 'not_equals' : 'equals', value: v }]);
    }
  });

it('exports the editors from the package index', async () => {
  const shared = await import('../index.js');
  expect(shared.addFieldClause('', 'service', 'api', false)).toBe('service:api');
  expect(shared.removeFieldClause('service:api', 'service')).toBe('');
  expect(shared.quoteFieldValue('*')).toBe('"*"');
});
