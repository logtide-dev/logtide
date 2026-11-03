import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { applyConnectionUrls, buildDatabaseUrl, buildRedisUrl } from '../../config/connection-urls.js';

// The password from discussion #317: # starts a URL fragment, % an escape
const NASTY = 'y!T8%#B0jN%WvdwrBn@/?:';

describe('buildDatabaseUrl', () => {
  it('encodes a password with URL-reserved characters so pg reads it back intact', () => {
    const url = buildDatabaseUrl({
      DB_HOST: 'postgres',
      DB_USER: 'svc_logtide',
      DB_PASSWORD: NASTY,
      DB_NAME: 'logtide',
    })!;

    expect(url).toBe(`postgresql://svc_logtide:${encodeURIComponent(NASTY)}@postgres:5432/logtide`);
    // what pg itself does with the string (the original report crashed in here)
    const params = new pg.Client({ connectionString: url }) as unknown as {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    };
    expect(params.host).toBe('postgres');
    expect(params.port).toBe(5432);
    expect(params.user).toBe('svc_logtide');
    expect(params.password).toBe(NASTY);
    expect(params.database).toBe('logtide');
  });

  it('uses DB_PORT, allows no password and brackets IPv6 hosts', () => {
    expect(buildDatabaseUrl({ DB_HOST: 'db', DB_PORT: '6543', DB_USER: 'u', DB_NAME: 'n' })).toBe(
      'postgresql://u@db:6543/n'
    );
    expect(buildDatabaseUrl({ DB_HOST: '::1', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' })).toBe(
      'postgresql://u:p@[::1]:5432/n'
    );
  });

  it('is off without DB_HOST and names what is missing with it', () => {
    expect(buildDatabaseUrl({ DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' })).toBeUndefined();
    expect(() => buildDatabaseUrl({ DB_HOST: 'db', DB_PASSWORD: 'p' })).toThrow(
      'DB_HOST is set but DB_USER and DB_NAME are missing'
    );
    expect(() => buildDatabaseUrl({ DB_HOST: 'db', DB_USER: 'u' })).toThrow('DB_HOST is set but DB_NAME is missing');
  });
});

describe('buildRedisUrl', () => {
  it('encodes the password and defaults the port', () => {
    expect(buildRedisUrl({ REDIS_HOST: 'redis', REDIS_PASSWORD: NASTY })).toBe(
      `redis://:${encodeURIComponent(NASTY)}@redis:6379`
    );
    expect(buildRedisUrl({ REDIS_HOST: 'redis', REDIS_PORT: '6380' })).toBe('redis://redis:6380');
    expect(buildRedisUrl({ REDIS_PASSWORD: 'p' })).toBeUndefined();
  });
});

describe('applyConnectionUrls', () => {
  const separate = {
    DB_HOST: 'postgres',
    DB_USER: 'u',
    DB_PASSWORD: 'p#1',
    DB_NAME: 'n',
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: 'r#1',
  };

  it('fills both URLs from the separate settings', () => {
    const env: Record<string, string | undefined> = { ...separate };
    applyConnectionUrls(env);
    expect(env.DATABASE_URL).toBe('postgresql://u:p%231@postgres:5432/n');
    expect(env.REDIS_URL).toBe('redis://:r%231@redis:6379');
  });

  it('keeps an explicit URL over the separate settings', () => {
    const env: Record<string, string | undefined> = {
      ...separate,
      DATABASE_URL: 'postgresql://managed:x@db.example.com:5432/prod',
      REDIS_URL: 'rediss://cache.example.com:6380',
    };
    applyConnectionUrls(env);
    expect(env.DATABASE_URL).toBe('postgresql://managed:x@db.example.com:5432/prod');
    expect(env.REDIS_URL).toBe('rediss://cache.example.com:6380');
  });

  it('treats an empty URL as unset, and drops it when nothing replaces it', () => {
    const env: Record<string, string | undefined> = { ...separate, DATABASE_URL: '', REDIS_URL: '' };
    applyConnectionUrls(env);
    expect(env.DATABASE_URL).toBe('postgresql://u:p%231@postgres:5432/n');
    expect(env.REDIS_URL).toBe('redis://:r%231@redis:6379');

    // empty REDIS_URL without REDIS_HOST must stay "no Redis", not an invalid ''
    const bare: Record<string, string | undefined> = { DATABASE_URL: 'postgresql://u@h/n', REDIS_URL: '' };
    applyConnectionUrls(bare);
    expect('REDIS_URL' in bare).toBe(false);
  });

  it('is idempotent', () => {
    const env: Record<string, string | undefined> = { ...separate };
    applyConnectionUrls(env);
    const first = { ...env };
    applyConnectionUrls(env);
    expect(env).toEqual(first);
  });
});
