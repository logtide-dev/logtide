import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadTestEnv } from '../../config/load-test-env.js';

const KEYS = ['STORAGE_ENGINE', 'CLICKHOUSE_HOST', 'MONGODB_URI', 'LTE_OTHER'];

describe('loadTestEnv', () => {
  let file: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-'));
    file = path.join(dir, '.env.test');
    fs.writeFileSync(
      file,
      'STORAGE_ENGINE=timescale\nCLICKHOUSE_HOST=file-host\nMONGODB_URI=mongodb://file\nLTE_OTHER=from-file\n'
    );
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('uses the file when nothing is set', () => {
    loadTestEnv(file);
    expect(process.env.STORAGE_ENGINE).toBe('timescale');
    expect(process.env.CLICKHOUSE_HOST).toBe('file-host');
  });

  it('keeps explicit engine variables over the file', () => {
    process.env.STORAGE_ENGINE = 'clickhouse';
    process.env.CLICKHOUSE_HOST = 'ch.local';
    process.env.MONGODB_URI = 'mongodb://explicit';
    loadTestEnv(file);
    expect(process.env.STORAGE_ENGINE).toBe('clickhouse');
    expect(process.env.CLICKHOUSE_HOST).toBe('ch.local');
    expect(process.env.MONGODB_URI).toBe('mongodb://explicit');
  });

  it('still lets the file override other variables', () => {
    process.env.LTE_OTHER = 'shell';
    loadTestEnv(file);
    expect(process.env.LTE_OTHER).toBe('from-file');
  });

  it('is stable when called twice', () => {
    process.env.STORAGE_ENGINE = 'mongodb';
    loadTestEnv(file);
    loadTestEnv(file);
    expect(process.env.STORAGE_ENGINE).toBe('mongodb');
  });
});
