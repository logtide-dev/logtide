import { describe, it, expect } from 'vitest';
import { validateFormula } from './metrics-formula';

const ids = ['A', 'B'];

describe('validateFormula', () => {
  it.each(['A', 'A / B * 100', '(A + B) / 2', '-A + 3', 'A*B', '1.5 * A'])('accepts %s', (e) => {
    expect(validateFormula(e, ids)).toBeNull();
  });

  it('asks for an expression when empty', () => {
    expect(validateFormula('  ', ids)).toMatch(/Enter an expression/);
  });

  it('reports unknown queries', () => {
    expect(validateFormula('A + C', ids)).toBe('Unknown query C');
  });

  it('reports unbalanced parentheses', () => {
    expect(validateFormula('(A + B', ids)).toBe('Missing closing parenthesis');
    expect(validateFormula('A + B)', ids)).toMatch(/Unexpected/);
  });

  it('reports dangling operators and bad characters', () => {
    expect(validateFormula('A +', ids)).toBe('Expression ends too early');
    expect(validateFormula('A $ B', ids)).toMatch(/Unexpected/);
    expect(validateFormula('A B', ids)).toMatch(/Unexpected/);
  });
});
