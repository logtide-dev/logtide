import { describe, it, expect } from 'vitest';
import { validateAttr, removeAttrChip } from './attr';

describe('validateAttr', () => {
  it('accepts blank input', () => {
    expect(validateAttr('')).toEqual({ ok: true, chips: [], error: '', position: 0 });
    expect(validateAttr(undefined)).toEqual({ ok: true, chips: [], error: '', position: 0 });
  });

  it('returns one chip per clause with negation and quotes kept', () => {
    const r = validateAttr('http.method:GET -http.status_code:500 http.route:"/a b/x"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chips.map((c) => c.text)).toEqual([
        'http.method:GET',
        '-http.status_code:500',
        'http.route:"/a b/x"',
      ]);
    }
  });

  it('rejects free text with its position', () => {
    const r = validateAttr('http.method:GET timeout');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.position).toBe(16);
  });

  it('rejects built-in keys', () => {
    const r = validateAttr('service:api');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/built-in/);
  });

  it('rejects an unbalanced quote', () => {
    expect(validateAttr('a.b:"oops').ok).toBe(false);
  });

  it('removeAttrChip drops one clause and keeps the rest', () => {
    const attr = 'a:1 b:"x y" c:3';
    const r = validateAttr(attr);
    if (!r.ok) throw new Error('expected ok');
    expect(removeAttrChip(attr, r.chips[1])).toBe('a:1 c:3');
    expect(removeAttrChip(attr, r.chips[0])).toBe('b:"x y" c:3');
    expect(removeAttrChip('a:1', r.chips[0])).toBe('');
  });
});
