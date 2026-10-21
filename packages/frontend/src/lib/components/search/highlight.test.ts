import { describe, it, expect } from 'vitest';
import { highlightSegments } from './highlight';

describe('highlightSegments', () => {
  it('marks full-text terms case-insensitively', () =>
    expect(highlightSegments('Timeout on DB', 'timeout db', 'fulltext')).toEqual([
      { text: 'Timeout', match: true },
      { text: ' on ', match: false },
      { text: 'DB', match: true },
    ]));

  it('does not mark in substring mode', () =>
    expect(highlightSegments('Timeout on DB', 'timeout', 'substring')).toEqual([
      { text: 'Timeout on DB', match: false },
    ]));

  it('escapes regex characters', () =>
    expect(highlightSegments('a+b (c)', 'a+b', 'fulltext')[0]).toEqual({ text: 'a+b', match: true }));
});
