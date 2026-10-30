import { describe, it, expect } from 'vitest';
import { jsonSegments, breakEscapedNewlines } from './json-highlight';

describe('jsonSegments', () => {
  it('covers every character once and classifies tokens', () => {
    const text = JSON.stringify({ a: 'x', n: -1500, b: true, z: null, l: [1] }, null, 2);
    const segs = jsonSegments(text);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    const kinds = (k: string) => segs.filter((s) => s.kind === k).map((s) => s.text);
    expect(kinds('key')).toEqual(['"a"', '"n"', '"b"', '"z"', '"l"']);
    expect(kinds('string')).toEqual(['"x"']);
    expect(kinds('number')).toEqual(['-1500', '1']);
    expect(kinds('boolean')).toEqual(['true']);
    expect(kinds('null')).toEqual(['null']);
  });

  it('does not treat words inside strings as tokens', () => {
    const segs = jsonSegments('{"m": "true null 5 \\" x"}');
    expect(segs.filter((s) => s.kind === 'string')).toHaveLength(1);
    expect(segs.some((s) => s.kind === 'boolean' || s.kind === 'null' || s.kind === 'number')).toBe(false);
  });

  it('breaks lines at escaped newlines for display only', () => {
    const seg = breakEscapedNewlines({ text: '"a\\nb"', kind: 'string' });
    expect(seg.text).toBe('"a\\n\nb"');
  });
});
