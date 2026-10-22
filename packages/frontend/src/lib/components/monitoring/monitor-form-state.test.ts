import { describe, it, expect } from 'vitest';
import type { Monitor } from '$lib/api/monitoring';
import {
  buildPayload,
  defaultValues,
  valuesFromMonitor,
  validateMonitorForm,
} from './monitor-form-state';

const CTX = { organizationId: 'org-1', projectId: 'proj-1' };

function monitor(over: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    name: 'API',
    type: 'http',
    target: 'https://example.com/health',
    intervalSeconds: 60,
    timeoutSeconds: 10,
    gracePeriodSeconds: null,
    failureThreshold: 2,
    autoResolve: true,
    enabled: true,
    httpConfig: null,
    severity: 'high',
    displayName: 'Public API',
    groupName: 'Core',
    displayOrder: 0,
    checkConfig: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

describe('defaultValues', () => {
  it('ssl has interval 3600, threshold 1, warnDays 14', () => {
    const v = defaultValues('ssl');
    expect(v.intervalSeconds).toBe('3600');
    expect(v.failureThreshold).toBe('1');
    expect(v.warnDays).toBe('14');
  });

  it('dns has interval 300 and recordType A', () => {
    const v = defaultValues('dns');
    expect(v.intervalSeconds).toBe('300');
    expect(v.recordType).toBe('A');
  });

  it('http has interval 60, timeout 10, threshold 2', () => {
    const v = defaultValues('http');
    expect([v.intervalSeconds, v.timeoutSeconds, v.failureThreshold]).toEqual(['60', '10', '2']);
  });
});

describe('validateMonitorForm', () => {
  it('rejects NaN and empty numeric inputs with a key per field', () => {
    const v = { ...defaultValues('http'), name: 'x', target: 'https://a.co' };
    v.intervalSeconds = '';
    v.timeoutSeconds = 'abc';
    v.failureThreshold = '1.5';
    const errors = validateMonitorForm(v, false);
    expect(Object.keys(errors).sort()).toEqual(['failureThreshold', 'intervalSeconds', 'timeoutSeconds']);
  });

  it('requires name, http scheme, tcp host:port, ssl host without scheme, dns hostname that is not an IP', () => {
    expect(validateMonitorForm(defaultValues('http'), false).name).toBeTruthy();

    const http = { ...defaultValues('http'), name: 'a', target: 'example.com' };
    expect(validateMonitorForm(http, false).target).toMatch(/http/);

    const tcp = { ...defaultValues('tcp'), name: 'a', target: 'db.example.com' };
    expect(validateMonitorForm(tcp, false).target).toMatch(/host:port/);
    expect(validateMonitorForm({ ...tcp, target: 'db.example.com:5432' }, false).target).toBeUndefined();

    const ssl = { ...defaultValues('ssl'), name: 'a', target: 'https://example.com' };
    expect(validateMonitorForm(ssl, false).target).toBeTruthy();
    expect(validateMonitorForm({ ...ssl, target: 'example.com:8443' }, false).target).toBeUndefined();

    const dns = { ...defaultValues('dns'), name: 'a', target: '10.0.0.1' };
    expect(validateMonitorForm(dns, false).target).toBeTruthy();
    expect(validateMonitorForm({ ...dns, target: 'example.com' }, false).target).toBeUndefined();
  });

  it('flags warnDays outside 1..365 and bad header names', () => {
    const ssl = { ...defaultValues('ssl'), name: 'a', target: 'example.com', warnDays: '0' };
    expect(validateMonitorForm(ssl, false).warnDays).toBeTruthy();

    const http = {
      ...defaultValues('http'),
      name: 'a',
      target: 'https://a.co',
      headers: [{ name: 'Bad Name', value: 'x' }],
    };
    expect(validateMonitorForm(http, false).headers).toBeTruthy();
  });

  it('accepts a valid http monitor', () => {
    const v = { ...defaultValues('http'), name: 'a', target: 'https://a.co' };
    expect(validateMonitorForm(v, false)).toEqual({});
  });
});

describe('buildPayload', () => {
  it('omits expectedStatus when blank and drops empty header rows', () => {
    const v = {
      ...defaultValues('http'),
      name: ' API ',
      target: 'https://a.co',
      headers: [
        { name: 'X-Token', value: 'abc' },
        { name: '', value: '' },
      ],
    };
    const p = buildPayload(v, CTX);
    expect(p.name).toBe('API');
    expect(p.httpConfig).toEqual({ method: 'GET', headers: { 'X-Token': 'abc' } });
    expect(p.httpConfig).not.toHaveProperty('expectedStatus');
  });

  it('sends checkConfig for ssl and dns only', () => {
    const ssl = buildPayload({ ...defaultValues('ssl'), name: 'a', target: 'example.com' }, CTX);
    expect(ssl.checkConfig).toEqual({ warnDays: 14 });

    const dns = buildPayload(
      { ...defaultValues('dns'), name: 'a', target: 'example.com', recordType: 'MX', expectedValue: ' mx.example.com ' },
      CTX
    );
    expect(dns.checkConfig).toEqual({ recordType: 'MX', expectedValue: 'mx.example.com' });

    const http = buildPayload({ ...defaultValues('http'), name: 'a', target: 'https://a.co' }, CTX);
    expect(http).not.toHaveProperty('checkConfig');
    const tcp = buildPayload({ ...defaultValues('tcp'), name: 'a', target: 'h:1' }, CTX);
    expect(tcp).not.toHaveProperty('checkConfig');
  });

  it('parses numbers, maps blank display fields to null and skips timeout for heartbeats', () => {
    const p = buildPayload({ ...defaultValues('heartbeat'), name: 'a', displayName: '  ', groupName: 'Core' }, CTX);
    expect(p.intervalSeconds).toBe(60);
    expect(p.displayName).toBeNull();
    expect(p.groupName).toBe('Core');
    expect(p.target).toBeNull();
    expect(p).not.toHaveProperty('timeoutSeconds');
  });
});

describe('valuesFromMonitor', () => {
  it('duplicate drops identity and appends " (copy)"', () => {
    const v = valuesFromMonitor(monitor(), 'duplicate');
    expect(v.name).toBe('API (copy)');
    expect(v.displayName).toBe('');
    expect(v.groupName).toBe('Core');
  });

  it('edit keeps the name and display name and reads http and ssl config', () => {
    const http = valuesFromMonitor(
      monitor({
        httpConfig: {
          method: 'POST',
          expectedStatus: 201,
          headers: { A: 'b' },
          bodyAssertion: { type: 'regex', pattern: 'ok.*' },
        },
      }),
      'edit'
    );
    expect(http.name).toBe('API');
    expect(http.displayName).toBe('Public API');
    expect(http.method).toBe('POST');
    expect(http.expectedStatus).toBe('201');
    expect(http.headers).toEqual([{ name: 'A', value: 'b' }]);
    expect(http.bodyAssertionKind).toBe('regex');

    const ssl = valuesFromMonitor(monitor({ type: 'ssl', checkConfig: { warnDays: 30 } }), 'edit');
    expect(ssl.warnDays).toBe('30');
  });
});
