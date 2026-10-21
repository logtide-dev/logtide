import { describe, it, expect } from 'vitest';
import { lexLogQuery } from './lexer.js';

describe('lexLogQuery', () => {
  it('splits clauses with spans', () => {
    const r = lexLogQuery('timeout -"a b" env:prod OR x');
    expect(r.items.map((i) => [i.type, i.start, i.end])).toEqual([
      ['text', 0, 7],
      ['text', 8, 14],
      ['field', 15, 23],
      ['or', 24, 26],
      ['text', 27, 28],
    ]);
    expect(r.items[1]).toMatchObject({ negated: true, quoted: true, value: 'a b' });
  });

  it('reads a parenthesised list across spaces', () => {
    const r = lexLogQuery('env:( "us east" OR eu )');
    expect(r.items).toHaveLength(1);
    expect((r.items[0] as any).value.values.map((v: any) => v.text)).toEqual(['us east', 'eu']);
  });

  // spec 5.3 colon rule, table driven
  it.each([
    ['10:42:13', 'text'],
    ['2026-01-05T10:42:13Z', 'text'],
    ['http://x', 'text'],
    ['https://api.example.com/v1', 'text'],
    ['Error:', 'text'],
    ['level:', 'text'],
    ['fe80::1', 'text'],
    ['2001:db8::1', 'text'],
    ['::1', 'text'],
    ['::ffff:10.0.0.1', 'text'],
    ['aa:bb:cc:dd:ee:ff', 'text'],
    ['.a:b', 'text'],
    ['a..b:c', 'text'],
    ['9k:v', 'text'],
    ['url://cdn', 'text'],
    ['env:prod', 'field'],
    ['_k:v', 'field'],
    ['x-request-id:abc', 'field'],
    ['a.b-c:v', 'field'],
    ['path:a:b', 'field'],
    ['k::v', 'field'],
    ['Error:x', 'field'],
    ['url:"//cdn"', 'field'],
  ])('%j is %s', (input, type) => expect(lexLogQuery(input).items.map((i) => i.type)).toEqual([type]));

  it('keeps the value after the first colon', () => {
    expect(lexLogQuery('path:a:b').items[0]).toMatchObject({ key: 'path', value: { kind: 'bare', text: 'a:b' } });
    expect(lexLogQuery('k::v').items[0]).toMatchObject({ key: 'k', value: { kind: 'bare', text: ':v' } });
  });

  it.each([
    ['foo"bar"', [['text', 0, 8, false]]], // quotes inside a bare token are literal
    [
      '"foo"bar',
      [
        ['text', 0, 5, false],
        ['text', 5, 8, false],
      ],
    ], // a closing quote ends the clause
    [
      'a - b',
      [
        ['text', 0, 1, false],
        ['text', 2, 3, false],
        ['text', 4, 5, false],
      ],
    ], // lone dash is text
    ['--verbose', [['text', 0, 9, false]]], // double dash is text, not negation
    ['""', [['text', 0, 2, false]]],
  ])('lexes %j without errors', (input, items) => {
    const r = lexLogQuery(input);
    expect(r.error).toBeUndefined();
    expect(r.items.map((i: any) => [i.type, i.start, i.end, i.negated])).toEqual(items);
  });

  it.each([
    ['"open', 'Unclosed quote', 0, true],
    ['env:(a OR b', 'Unclosed parenthesis', 4, true],
    [
      'foo(bar)',
      'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it',
      3,
      false,
    ],
    [
      '(timeout OR refused)',
      'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it',
      0,
      false,
    ],
    [
      'env:(a OR (b))',
      'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it',
      10,
      false,
    ],
    [
      'path:/a(b)',
      'Parentheses are only supported in field lists like key:(a OR b); put text in quotes to search for it',
      7,
      false,
    ],
    ['env:()', 'Empty value list', 4, false],
    ['env:(a b)', 'Separate values with OR, like key:(a OR b)', 7, false],
    ['env:(a OR)', 'OR needs a term on both sides', 7, false],
  ])('reports %j', (input, message, position, structural) => {
    const r = lexLogQuery(input);
    expect(r.error).toEqual({ message, position });
    expect(r.structural).toBe(structural);
  });

  it('rejects input over 4096 chars at position 4096', () => {
    expect(lexLogQuery('a'.repeat(4097)).error).toEqual({
      message: 'Query is too long (max 4,096 characters)',
      position: 4096,
    });
  });

  it('unescapes quoted values', () => {
    expect(lexLogQuery('k:"say \\"hi\\" C:\\\\x"').items[0]).toMatchObject({
      value: { kind: 'quoted', text: 'say "hi" C:\\x' },
    });
  });

  it('keeps scanning after a non-structural error', () => {
    expect(lexLogQuery('foo(bar) timeout').items.map((i) => i.type)).toEqual(['error', 'text']);
  });

  it('flags an unclosed quote inside a list as structural', () => {
    const r = lexLogQuery('env:("us east');
    expect(r.error).toEqual({ message: 'Unclosed parenthesis', position: 4 });
    expect(r.structural).toBe(true);
  });

  it('reports an unclosed parenthesis before an inner list error', () => {
    const r = lexLogQuery('env:(a b');
    expect(r.error).toEqual({ message: 'Unclosed parenthesis', position: 4 });
    expect(r.structural).toBe(true);
  });

  it.each([
    ['env:(OR a)', 'OR needs a term on both sides', 5],
    ['env:(a OR OR b)', 'OR needs a term on both sides', 7],
    ['env:(a AND b)', 'Separate values with OR, like key:(a OR b)', 7],
    ['env:(  )', 'Empty value list', 4],
  ])('reports list error %j', (input, message, position) => {
    expect(lexLogQuery(input).error).toEqual({ message, position });
  });

  it('records list values with positions and quoting', () => {
    const item = lexLogQuery('k:(a OR "b c")').items[0] as any;
    expect(item.value).toEqual({
      kind: 'list',
      open: 2,
      values: [
        { text: 'a', quoted: false, start: 3, end: 4 },
        { text: 'b c', quoted: true, start: 8, end: 13 },
      ],
    });
    expect(item.end).toBe(14);
  });

  it('ends a field clause at the closing quote of its value', () => {
    expect(lexLogQuery('k:"a"b').items.map((i) => [i.type, i.start, i.end])).toEqual([
      ['field', 0, 5],
      ['text', 5, 6],
    ]);
  });

  it('treats IPv6 with a zone and MAC shapes as text', () => {
    expect(lexLogQuery('fe80::1%eth0').items.map((i) => i.type)).toEqual(['text']);
    expect(lexLogQuery('dead:beef').items.map((i) => i.type)).toEqual(['field']);
  });

  it('marks AND and OR only when bare, uppercase and not negated', () => {
    expect(lexLogQuery('a AND b or c -OR "OR"').items.map((i) => i.type)).toEqual([
      'text',
      'and',
      'text',
      'text',
      'text',
      'text',
      'text',
    ]);
  });

  it('consumes an unclosed quote to the end of input', () => {
    const r = lexLogQuery('a -"b c');
    expect(r.items.map((i) => [i.type, i.start, i.end])).toEqual([
      ['text', 0, 1],
      ['error', 2, 7],
    ]);
    expect(r.error).toEqual({ message: 'Unclosed quote', position: 3 });
  });
});
