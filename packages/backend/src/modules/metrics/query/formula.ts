// Formulas over query results: a hand-written tokenizer and recursive descent
// parser (numbers, query ids A..F, + - * /, unary minus, parentheses; never
// eval), and an evaluator that joins series by identical labels.

import type { FoldResult, GridSeries } from './series-fold.js';
import { labelKey, OTHER_LABEL, rankByMean } from './series-fold.js';

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; id: string }
  | { kind: 'neg'; operand: FormulaNode }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode };

type Token =
  | { type: 'num'; value: number; pos: number }
  | { type: 'ref'; id: string; pos: number }
  | { type: 'op'; op: '+' | '-' | '*' | '/'; pos: number }
  | { type: 'lparen' | 'rparen'; pos: number };

const MAX_EXPRESSION_LENGTH = 500;
const MAX_DEPTH = 50;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ type: 'op', op: c, pos: i });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', pos: i });
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      const start = i;
      while (i < expression.length && /[0-9.]/.test(expression[i])) i++;
      if (i < expression.length && (expression[i] === 'e' || expression[i] === 'E')) {
        i++;
        if (expression[i] === '+' || expression[i] === '-') i++;
        while (i < expression.length && /[0-9]/.test(expression[i])) i++;
      }
      const text = expression.slice(start, i);
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
        throw new FormulaError(`Invalid number "${text}" at position ${start + 1}`);
      }
      tokens.push({ type: 'num', value: Number(text), pos: start });
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_]/.test(expression[i])) i++;
      const id = expression.slice(start, i);
      if (!/^[A-F]$/.test(id)) throw new FormulaError(`Unknown name "${id}" at position ${start + 1}`);
      tokens.push({ type: 'ref', id, pos: start });
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}" at position ${i + 1}`);
  }
  return tokens;
}

/** Parse a formula expression; throws FormulaError with a readable message. */
export function parseFormula(expression: string): FormulaNode {
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new FormulaError('Formula is too long');
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new FormulaError('Formula is empty');
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  function expr(depth: number): FormulaNode {
    let left = term(depth);
    for (let t = peek(); t && t.type === 'op' && (t.op === '+' || t.op === '-'); t = peek()) {
      pos++;
      left = { kind: 'bin', op: t.op, left, right: term(depth) };
    }
    return left;
  }

  function term(depth: number): FormulaNode {
    let left = unary(depth);
    for (let t = peek(); t && t.type === 'op' && (t.op === '*' || t.op === '/'); t = peek()) {
      pos++;
      left = { kind: 'bin', op: t.op, left, right: unary(depth) };
    }
    return left;
  }

  function unary(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply');
    const t = peek();
    if (t && t.type === 'op' && (t.op === '-' || t.op === '+')) {
      pos++;
      const operand = unary(depth + 1);
      return t.op === '-' ? { kind: 'neg', operand } : operand;
    }
    return primary(depth);
  }

  function primary(depth: number): FormulaNode {
    const t = peek();
    if (!t) throw new FormulaError('Formula ends unexpectedly');
    pos++;
    if (t.type === 'num') return { kind: 'num', value: t.value };
    if (t.type === 'ref') return { kind: 'ref', id: t.id };
    if (t.type === 'lparen') {
      const inner = expr(depth + 1);
      const close = peek();
      if (!close || close.type !== 'rparen') throw new FormulaError(`Missing ")" for "(" at position ${t.pos + 1}`);
      pos++;
      return inner;
    }
    throw new FormulaError(`Unexpected "${t.type === 'op' ? t.op : ')'}" at position ${t.pos + 1}`);
  }

  const ast = expr(0);
  const rest = peek();
  if (rest) throw new FormulaError(`Unexpected token at position ${rest.pos + 1}`);
  return ast;
}

/** Query ids a formula reads, in first-use order. */
export function formulaRefs(node: FormulaNode): string[] {
  const out: string[] = [];
  const walk = (n: FormulaNode) => {
    if (n.kind === 'ref') {
      if (!out.includes(n.id)) out.push(n.id);
    } else if (n.kind === 'neg') walk(n.operand);
    else if (n.kind === 'bin') {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(node);
  return out;
}

type Value = { kind: 'scalar'; value: number } | { kind: 'set'; series: GridSeries[] };

function applyOp(op: '+' | '-' | '*' | '/', a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    default:
      return b === 0 ? null : a / b;
  }
}

function isBroadcast(series: GridSeries[]): boolean {
  return series.length === 1 && Object.keys(series[0].labels).length === 0;
}

function zip(
  op: '+' | '-' | '*' | '/',
  labels: Record<string, string>,
  left: (i: number) => number | null,
  right: (i: number) => number | null,
  length: number,
): GridSeries {
  const values: Array<number | null> = new Array(length);
  for (let i = 0; i < length; i++) {
    const v = applyOp(op, left(i), right(i));
    values[i] = v !== null && Number.isFinite(v) ? v : null;
  }
  return { labels, values };
}

function binary(op: '+' | '-' | '*' | '/', a: Value, b: Value, length: number): Value {
  if (a.kind === 'scalar' && b.kind === 'scalar') {
    const v = applyOp(op, a.value, b.value);
    if (v === null || !Number.isFinite(v)) {
      return { kind: 'set', series: [{ labels: {}, values: new Array(length).fill(null) }] };
    }
    return { kind: 'scalar', value: v };
  }
  if (a.kind === 'scalar' && b.kind === 'set') {
    return { kind: 'set', series: b.series.map((s) => zip(op, s.labels, () => a.value, (i) => s.values[i], length)) };
  }
  if (a.kind === 'set' && b.kind === 'scalar') {
    return { kind: 'set', series: a.series.map((s) => zip(op, s.labels, (i) => s.values[i], () => b.value, length)) };
  }
  const left = (a as { series: GridSeries[] }).series;
  const right = (b as { series: GridSeries[] }).series;
  if (isBroadcast(left) && !isBroadcast(right)) {
    const l = left[0];
    return { kind: 'set', series: right.map((s) => zip(op, s.labels, (i) => l.values[i], (i) => s.values[i], length)) };
  }
  if (isBroadcast(right) && !isBroadcast(left)) {
    const r = right[0];
    return { kind: 'set', series: left.map((s) => zip(op, s.labels, (i) => s.values[i], (i) => r.values[i], length)) };
  }
  // Join on identical label sets; series without a partner are dropped.
  const byKey = new Map<string, GridSeries>();
  for (const s of right) byKey.set(labelKey(s.labels), s);
  const out: GridSeries[] = [];
  for (const s of left) {
    const partner = byKey.get(labelKey(s.labels));
    if (partner) out.push(zip(op, s.labels, (i) => s.values[i], (i) => partner.values[i], length));
  }
  return { kind: 'set', series: out };
}

/**
 * Evaluate a parsed formula. `operands` maps query ids to their (already
 * folded) series; every referenced id must be present. A formula made only of
 * numbers yields one ungrouped constant series.
 */
export function evaluateFormula(node: FormulaNode, operands: Map<string, GridSeries[]>, length: number): GridSeries[] {
  const evaluate = (n: FormulaNode): Value => {
    switch (n.kind) {
      case 'num':
        return { kind: 'scalar', value: n.value };
      case 'ref': {
        const series = operands.get(n.id);
        if (!series) throw new FormulaError(`Query ${n.id} is not available`);
        return { kind: 'set', series };
      }
      case 'neg':
        return binary('*', { kind: 'scalar', value: -1 }, evaluate(n.operand), length);
      default:
        return binary(n.op, evaluate(n.left), evaluate(n.right), length);
    }
  };
  const result = evaluate(node);
  if (result.kind === 'scalar') return [{ labels: {}, values: new Array(length).fill(result.value) }];
  return result.series;
}

/** One operand of a folded formula: its unfolded groups and how to fold some of them. */
export interface FormulaOperand {
  groups: GridSeries[];
  /** Combine some of the groups into one series (the query's own fold of them). */
  combine: (members: GridSeries[]) => GridSeries;
}

/**
 * Evaluate a formula on unfolded operands, then keep the top `limit` result
 * series by mean and fold the rest. The folded "Other" is the formula applied
 * to each operand's own fold of the same groups (sum of errors over sum of
 * requests, not a sum of ratios), so an "Other" is never joined with another
 * query's unrelated "Other".
 */
export function evaluateFormulaFolded(
  node: FormulaNode,
  operands: Map<string, FormulaOperand>,
  limit: number,
  length: number,
): FoldResult {
  const groups = new Map<string, GridSeries[]>();
  for (const [id, op] of operands) groups.set(id, op.groups);
  const result = evaluateFormula(node, groups, length);
  const seriesTotal = result.length;
  const grouped = result.some((s) => Object.keys(s.labels).length > 0);
  if (!grouped || seriesTotal <= limit) return { series: result, seriesTotal, seriesShown: seriesTotal };

  const ranked = rankByMean(result);
  const kept = ranked.slice(0, limit);
  const restKeys = new Set(ranked.slice(limit).map((s) => labelKey(s.labels)));
  const otherLabels = { [OTHER_LABEL]: 'true' };
  const folded = new Map<string, GridSeries[]>();
  for (const [id, op] of operands) {
    if (op.groups.length === 0 || isBroadcast(op.groups)) {
      folded.set(id, op.groups);
      continue;
    }
    const members = op.groups.filter((g) => restKeys.has(labelKey(g.labels)));
    folded.set(id, [{ labels: otherLabels, values: op.combine(members).values }]);
  }
  const other = evaluateFormula(node, folded, length).find((s) => s.labels[OTHER_LABEL] === 'true');
  return {
    series: [...kept, other ?? { labels: otherLabels, values: new Array(length).fill(null) }],
    seriesTotal,
    seriesShown: kept.length,
  };
}

/** A formula keeps a unit only when every query it reads has that same unit. */
export function formulaUnit(refs: string[], units: Map<string, string | null>): string | null {
  if (refs.length === 0) return null;
  const first = units.get(refs[0]) ?? null;
  if (first === null) return null;
  return refs.every((id) => (units.get(id) ?? null) === first) ? first : null;
}
