import { describe, it, expect } from 'vitest';
import {
  parseFormula,
  evaluateFormula,
  formulaRefs,
  formulaUnit,
  FormulaError,
} from '../../../../modules/metrics/query/formula.js';
import type { GridSeries } from '../../../../modules/metrics/query/series-fold.js';

const flat = (v: number | null, n = 3): GridSeries => ({ labels: {}, values: new Array(n).fill(v) });
const ev = (expr: string, ops: Record<string, GridSeries[]>, n = 3) =>
  evaluateFormula(parseFormula(expr), new Map(Object.entries(ops)), n);

describe('formula parser', () => {
  it('respects precedence and associativity', () => {
    expect(ev('1 + 2 * 3', {})[0].values[0]).toBe(7);
    expect(ev('10 - 4 - 3', {})[0].values[0]).toBe(3);
    expect(ev('16 / 4 / 2', {})[0].values[0]).toBe(2);
    expect(ev('2 * 3 + 4 * 5', {})[0].values[0]).toBe(26);
  });

  it('handles parentheses and unary minus', () => {
    expect(ev('(1 + 2) * 3', {})[0].values[0]).toBe(9);
    expect(ev('-(2 + 3) * 2', {})[0].values[0]).toBe(-10);
    expect(ev('--4', {})[0].values[0]).toBe(4);
    expect(ev('((((1))))', {})[0].values[0]).toBe(1);
    expect(ev('1.5e2 + .5', {})[0].values[0]).toBe(150.5);
  });

  it('reads query ids', () => {
    expect(formulaRefs(parseFormula('A / (B + A) * 100'))).toEqual(['A', 'B']);
  });

  it('rejects bad syntax with readable errors', () => {
    const bad = ['', '   ', 'A +', '(A + B', 'A + B)', 'A B', 'G + 1', 'cpu', '1..2', 'A % B', 'eval(1)', '2 *', ')'];
    for (const expr of bad) expect(() => parseFormula(expr), expr).toThrow(FormulaError);
    expect(() => parseFormula('(A')).toThrow(/Missing "\)"/);
    expect(() => parseFormula('A $ B')).toThrow(/Unexpected character "\$" at position 3/);
    expect(() => parseFormula('x'.repeat(501))).toThrow(/too long/);
    expect(() => parseFormula('('.repeat(80) + '1' + ')'.repeat(80))).toThrow(/nested too deeply/);
  });
});

describe('formula evaluation', () => {
  it('gives null on division by zero and missing operands', () => {
    const A: GridSeries = { labels: {}, values: [10, 10, null] };
    const B: GridSeries = { labels: {}, values: [2, 0, 5] };
    expect(ev('A / B', { A: [A], B: [B] })[0].values).toEqual([5, null, null]);
    expect(ev('1 / 0', {})[0].values).toEqual([null, null, null]);
  });

  it('joins series by identical labels and drops unmatched ones', () => {
    const A = [
      { labels: { host: 'a' }, values: [10, 20] },
      { labels: { host: 'b' }, values: [30, 40] },
      { labels: { host: 'c' }, values: [1, 1] },
    ];
    const B = [
      { labels: { host: 'b' }, values: [3, 4] },
      { labels: { host: 'a' }, values: [5, 10] },
    ];
    const out = ev('A / B', { A, B }, 2);
    expect(out).toEqual([
      { labels: { host: 'a' }, values: [2, 2] },
      { labels: { host: 'b' }, values: [10, 10] },
    ]);
  });

  it('broadcasts a single ungrouped operand', () => {
    const A = [
      { labels: { host: 'a' }, values: [10, 20] },
      { labels: { host: 'b' }, values: [30, 40] },
    ];
    const total = [{ labels: {}, values: [40, 80] }];
    expect(ev('A / T * 100'.replace('T', 'B'), { A, B: total }, 2).map((s) => s.values)).toEqual([
      [25, 25],
      [75, 50],
    ]);
    expect(ev('B - A', { A, B: total }, 2).map((s) => s.labels)).toEqual([{ host: 'a' }, { host: 'b' }]);
  });

  it('combines scalars with series and folded __other__ series', () => {
    const A = [
      { labels: { h: 'a' }, values: [1, 2] },
      { labels: { __other__: 'true' }, values: [3, null] },
    ];
    expect(ev('A * 2 + 1', { A }, 2).map((s) => s.values)).toEqual([
      [3, 5],
      [7, null],
    ]);
    expect(ev('A - A', { A }, 2).map((s) => s.labels)).toEqual([{ h: 'a' }, { __other__: 'true' }]);
  });

  it('fails for a missing query', () => {
    expect(() => ev('A + B', { A: [flat(1)] })).toThrow(/Query B is not available/);
  });

  it('keeps a unit only when all operands share it', () => {
    const units = new Map<string, string | null>([
      ['A', 'By'],
      ['B', 'By'],
      ['C', 's'],
      ['D', null],
    ]);
    expect(formulaUnit(['A', 'B'], units)).toBe('By');
    expect(formulaUnit(['A', 'C'], units)).toBeNull();
    expect(formulaUnit(['D'], units)).toBeNull();
    expect(formulaUnit([], units)).toBeNull();
  });
});
