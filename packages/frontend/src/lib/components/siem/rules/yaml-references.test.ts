import { describe, it, expect } from 'vitest';
import { extractReferences } from './yaml-references';

describe('extractReferences', () => {
  it('reads a block list', () => {
    const yaml = [
      'title: x',
      'references:',
      '  - https://attack.mitre.org/techniques/T1059/',
      "  - 'https://example.com/post'",
      'level: high',
    ].join('\n');
    expect(extractReferences(yaml)).toEqual([
      'https://attack.mitre.org/techniques/T1059/',
      'https://example.com/post',
    ]);
  });

  it('reads an inline list', () => {
    expect(extractReferences('references: [https://a.test/x, "https://b.test/y"]')).toEqual([
      'https://a.test/x',
      'https://b.test/y',
    ]);
  });

  it('ignores non-http entries and missing sections', () => {
    expect(extractReferences('references:\n  - not a url\n')).toEqual([]);
    expect(extractReferences('title: x')).toEqual([]);
  });
});
