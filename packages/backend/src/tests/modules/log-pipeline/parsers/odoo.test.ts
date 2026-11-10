import { describe, it, expect } from 'vitest';
import { parseOdoo } from '../../../../modules/log-pipeline/parsers/odoo.js';

describe('parseOdoo', () => {
  it('parses a normal log line', () => {
    const line = '2026-11-10 09:12:44,123 12345 INFO mydb odoo.modules.loading: 42 modules loaded in 0.31s, 0 queries (+0 extra)';
    const result = parseOdoo(line);
    expect(result?.timestamp).toBe('2026-11-10 09:12:44,123');
    expect(result?.pid).toBe(12345);
    expect(result?.level).toBe('info');
    expect(result?.odoo_level).toBe('INFO');
    expect(result?.dbname).toBe('mydb');
    expect(result?.logger).toBe('odoo.modules.loading');
    expect(result?.message).toBe('42 modules loaded in 0.31s, 0 queries (+0 extra)');
    expect(result?.http_status).toBeUndefined();
  });

  it('maps ERROR and WARNING levels', () => {
    const err = parseOdoo('2026-11-10 09:12:45,001 12346 ERROR mydb odoo.http: Exception during request handling.');
    expect(err?.level).toBe('error');
    expect(err?.odoo_level).toBe('ERROR');
    const warn = parseOdoo('2026-11-10 09:12:45,001 1 WARNING mydb odoo.x: careful');
    expect(warn?.level).toBe('warn');
    expect(warn?.odoo_level).toBe('WARNING');
  });

  it('treats ? dbname as absent', () => {
    const line = '2026-11-10 09:12:45,002 12346 WARNING ? odoo.service.server: Thread <Thread(odoo.service.cron.cron0)> virtual real time limit';
    const result = parseOdoo(line);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('dbname');
    expect(result?.level).toBe('warn');
    expect(result?.logger).toBe('odoo.service.server');
    expect(result?.message).toBe('Thread <Thread(odoo.service.cron.cron0)> virtual real time limit');
  });

  it('parses werkzeug access line with perf info', () => {
    const line = '2026-11-10 09:12:46,532 12347 INFO mydb werkzeug: 192.168.1.10 - - [10/Nov/2026 09:12:46] "POST /web/dataset/call_kw/res.partner/web_search_read HTTP/1.1" 200 - 14 0.012 0.045';
    const result = parseOdoo(line);
    expect(result?.logger).toBe('werkzeug');
    expect(result?.client_ip).toBe('192.168.1.10');
    expect(result?.http_method).toBe('POST');
    expect(result?.http_path).toBe('/web/dataset/call_kw/res.partner/web_search_read');
    expect(result?.http_version).toBe('1.1');
    expect(result?.http_status).toBe(200);
    expect(result?.query_count).toBe(14);
    expect(result?.query_time).toBe(0.012);
    expect(result?.remaining_time).toBe(0.045);
    expect(result?.duration_ms).toBe(57);
  });

  it('parses werkzeug access line without perf info', () => {
    const line = '2026-11-10 09:12:46,532 12347 INFO mydb werkzeug: 10.0.0.2 - - [10/Nov/2026 09:12:46] "GET /web/login?redirect=1 HTTP/1.1" 200 -';
    const result = parseOdoo(line);
    expect(result?.http_method).toBe('GET');
    expect(result?.http_path).toBe('/web/login');
    expect(result?.http_query).toBe('redirect=1');
    expect(result?.http_status).toBe(200);
    expect(result).not.toHaveProperty('query_count');
    expect(result).not.toHaveProperty('duration_ms');
  });

  it('handles dash placeholders in perf info', () => {
    const line = '2026-11-10 09:12:46,532 12347 INFO mydb werkzeug: 10.0.0.2 - - [10/Nov/2026 09:12:46] "GET /x HTTP/1.1" 304 - - - -';
    const result = parseOdoo(line);
    expect(result?.http_status).toBe(304);
    expect(result).not.toHaveProperty('query_count');
    expect(result).not.toHaveProperty('duration_ms');
  });

  it('strips ANSI colors from perf numbers', () => {
    const line = '2026-11-10 09:12:46,532 12347 INFO mydb werkzeug: 192.168.1.10 - - [10/Nov/2026 09:12:46] "GET /web HTTP/1.1" \x1b[32m200\x1b[0m - \x1b[0m14\x1b[0m \x1b[33m0.012\x1b[0m \x1b[33m0.045\x1b[0m';
    const result = parseOdoo(line);
    expect(result?.http_status).toBe(200);
    expect(result?.query_count).toBe(14);
    expect(result?.query_time).toBe(0.012);
    expect(result?.remaining_time).toBe(0.045);
    expect(result?.duration_ms).toBe(57);
  });

  it('returns null for non-matching lines', () => {
    expect(parseOdoo('Traceback (most recent call last):')).toBeNull();
    expect(parseOdoo('  File "/odoo/http.py", line 1, in x')).toBeNull();
    expect(parseOdoo('not an odoo line')).toBeNull();
  });
});
