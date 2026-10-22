import { describe, it, expect } from 'vitest';
import { SigmaParser } from '../../../modules/sigma/parser.js';
import {
  reconstructYaml,
  assertYamlWithinLimit,
  YamlTooLargeError,
} from '../../../modules/sigma/yaml.js';

const row = {
  title: 'Suspicious shell',
  sigma_id: 'b0000000-0000-0000-0000-000000000001',
  status: 'stable',
  description: 'Detects a shell',
  author: 'tester',
  date: new Date('2026-03-04T00:00:00Z'),
  level: 'high',
  tags: ['attack.execution', 'attack.t1059'],
  logsource: { product: 'linux' },
  detection: { selection: { 'message|contains': 'bash -i' }, condition: 'selection' },
};

describe('reconstructYaml', () => {
  it('round trips through SigmaParser to the same detection', () => {
    const parsed = SigmaParser.parse(reconstructYaml(row));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rule?.detection).toEqual(row.detection);
    expect(parsed.rule?.logsource).toEqual(row.logsource);
    expect(parsed.rule?.title).toBe(row.title);
    expect(parsed.rule?.level).toBe('high');
    expect(parsed.rule?.id).toBe(row.sigma_id);
  });

  it('is deterministic with a fixed key order', () => {
    const a = reconstructYaml(row);
    const b = reconstructYaml({ ...row });
    expect(a).toBe(b);
    const keys = a
      .split('\n')
      .filter((l) => /^[a-z]+:/.test(l))
      .map((l) => l.split(':')[0]);
    expect(keys).toEqual([
      'title',
      'id',
      'status',
      'description',
      'author',
      'date',
      'level',
      'tags',
      'logsource',
      'detection',
    ]);
    expect(a).toContain("date: '2026-03-04'");
  });

  it('drops null and empty keys', () => {
    const out = reconstructYaml({ ...row, author: null, tags: [], description: null });
    expect(out).not.toMatch(/^author:/m);
    expect(out).not.toMatch(/^tags:/m);
    expect(out).not.toMatch(/^description:/m);
  });
});

describe('assertYamlWithinLimit', () => {
  it('accepts exactly 64 KiB and rejects one byte more', () => {
    expect(() => assertYamlWithinLimit('a'.repeat(65536))).not.toThrow();
    expect(() => assertYamlWithinLimit('a'.repeat(65537))).toThrow(YamlTooLargeError);
  });

  it('counts bytes, not characters', () => {
    // two bytes per character in UTF-8
    const twoByte = String.fromCharCode(0xe9);
    expect(() => assertYamlWithinLimit(twoByte.repeat(32768))).not.toThrow();
    expect(() => assertYamlWithinLimit(twoByte.repeat(32769))).toThrow(YamlTooLargeError);
  });
});
