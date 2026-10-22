import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestContext } from '../../helpers/index.js';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';

// ---------------------------------------------------------------------------
// Mock safeFetch (and keep SsrfBlockedError real for throw/catch assertions)
// ---------------------------------------------------------------------------
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock('../../../utils/ssrf-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/ssrf-guard.js')>(
    '../../../utils/ssrf-guard.js'
  );
  return { ...actual, safeFetch: safeFetchMock };
});

// Mock resolveAndValidateHost so TCP tests don't do real DNS
const { resolveAndValidateMock } = vi.hoisted(() => ({ resolveAndValidateMock: vi.fn() }));
vi.mock('../../../utils/ssrf-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/ssrf-guard.js')>(
    '../../../utils/ssrf-guard.js'
  );
  return {
    ...actual,
    safeFetch: safeFetchMock,
    resolveAndValidateHost: resolveAndValidateMock,
  };
});

// Mock net.createConnection so TCP tests don't open real sockets
import { EventEmitter } from 'events';
const { createConnectionMock } = vi.hoisted(() => ({ createConnectionMock: vi.fn() }));
vi.mock('net', async () => {
  const actual = await vi.importActual<typeof import('net')>('net');
  return { ...actual, createConnection: createConnectionMock };
});

// Mock tls.connect so SSL tests do not open real sockets
const { tlsConnectMock } = vi.hoisted(() => ({ tlsConnectMock: vi.fn() }));
vi.mock('tls', async () => {
  const actual = await vi.importActual<typeof import('tls')>('tls');
  return { ...actual, connect: tlsConnectMock, default: { ...actual, connect: tlsConnectMock } };
});

import {
  parseTcpTarget,
  parseHostPort,
  isValidDnsHostname,
  runSslCheck,
  runDnsCheck,
  runHttpCheck,
  runTcpCheck,
  runHeartbeatCheck,
  runLogHeartbeatCheck,
} from '../../../modules/monitoring/checker.js';
import { SsrfBlockedError } from '../../../utils/ssrf-guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResponse(status: number, text = 'ok') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => text,
  };
}

/** Build a minimal fake socket (EventEmitter + destroy). */
function makeFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
  socket.destroy = vi.fn();
  return socket;
}

beforeEach(() => {
  safeFetchMock.mockReset();
  resolveAndValidateMock.mockReset();
  createConnectionMock.mockReset();
  tlsConnectMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

// ===========================================================================
// parseTcpTarget
// ===========================================================================
describe('parseTcpTarget', () => {
  it('parses host:port', () => {
    expect(parseTcpTarget('example.com:443')).toEqual({ host: 'example.com', port: 443 });
  });

  it('parses 127.0.0.1:5432', () => {
    expect(parseTcpTarget('127.0.0.1:5432')).toEqual({ host: '127.0.0.1', port: 5432 });
  });

  it('parses IPv6 bracket form [::1]:5432', () => {
    expect(parseTcpTarget('[::1]:5432')).toEqual({ host: '::1', port: 5432 });
  });

  it('parses IPv6 bracket form [2001:db8::1]:80', () => {
    expect(parseTcpTarget('[2001:db8::1]:80')).toEqual({ host: '2001:db8::1', port: 80 });
  });

  it('throws when port is missing', () => {
    expect(() => parseTcpTarget('example.com')).toThrow('TCP target must be host:port');
  });

  it('throws for empty string', () => {
    expect(() => parseTcpTarget('')).toThrow('TCP target must be host:port');
  });
});

// ===========================================================================
// runHttpCheck
// ===========================================================================
describe('runHttpCheck', () => {
  it('returns up with statusCode when response matches expectedStatus', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200));
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(result.errorCode).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns down with http_error when status does not match expected', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(500));
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(500);
    expect(result.errorCode).toBe('http_error');
  });

  it('returns down with http_error for 404 when expected is 200', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(404));
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });

  it('accepts custom expectedStatus', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(201));
    const result = await runHttpCheck('https://example.com', 10, { expectedStatus: 201 });
    expect(result.status).toBe('up');
  });

  it('returns blocked when SsrfBlockedError is thrown', async () => {
    safeFetchMock.mockRejectedValue(new SsrfBlockedError('blocked'));
    const result = await runHttpCheck('http://169.254.169.254', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('blocked');
    expect(result.statusCode).toBeNull();
  });

  it('returns timeout when AbortError is thrown', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    safeFetchMock.mockRejectedValue(abortErr);
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('timeout');
  });

  it('returns connection_refused when ECONNREFUSED error is thrown', async () => {
    safeFetchMock.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:80'));
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('connection_refused');
  });

  it('returns dns_error when ENOTFOUND error is thrown', async () => {
    safeFetchMock.mockRejectedValue(new Error('ENOTFOUND example.invalid'));
    const result = await runHttpCheck('https://example.invalid', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('dns_error');
  });

  it('returns dns_error when EAI_ error is thrown', async () => {
    safeFetchMock.mockRejectedValue(new Error('EAI_AGAIN host lookup failure'));
    const result = await runHttpCheck('https://example.invalid', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('dns_error');
  });

  it('returns ssl_error when SSL error is thrown', async () => {
    safeFetchMock.mockRejectedValue(new Error('SSL certificate verification failed'));
    const result = await runHttpCheck('https://bad-cert.example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('ssl_error');
  });

  it('returns ssl_error for CERT_ errors', async () => {
    safeFetchMock.mockRejectedValue(new Error('CERT_HAS_EXPIRED'));
    const result = await runHttpCheck('https://expired.example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('ssl_error');
  });

  it('returns unexpected for unknown errors', async () => {
    safeFetchMock.mockRejectedValue(new Error('some random problem'));
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('unexpected');
  });

  it('returns unexpected when non-Error is thrown', async () => {
    safeFetchMock.mockRejectedValue('string error');
    const result = await runHttpCheck('https://example.com', 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('unexpected');
  });

  // bodyAssertion: contains
  it('up when body contains expected keyword', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200, 'server is healthy'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'contains', value: 'healthy' },
    });
    expect(result.status).toBe('up');
  });

  it('down when body does not contain expected keyword', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200, 'server is degraded'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'contains', value: 'healthy' },
    });
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });

  // bodyAssertion: regex
  it('up when body matches regex pattern', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200, 'status: ok'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'regex', pattern: 'status: \\w+' },
    });
    expect(result.status).toBe('up');
  });

  it('down when body does not match regex pattern', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200, 'error state'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'regex', pattern: '^status:' },
    });
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });

  it('down (http_error) when regex is flagged as unsafe (ReDoS guard)', async () => {
    // A catastrophic backtracking pattern that safe-regex2 should flag
    safeFetchMock.mockResolvedValue(makeResponse(200, 'aaaaaaaaaaaaaaaaaaaaaaaab'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'regex', pattern: '(a+)+$' },
    });
    // safe-regex2 flags this; result must be down, not up
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });

  it('down (http_error) when regex is invalid (throws during compile)', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(200, 'hello'));
    const result = await runHttpCheck('https://example.com', 10, {
      bodyAssertion: { type: 'regex', pattern: '[invalid' },
    });
    // safe-regex2 may or may not flag it, but invalid regex throws and is caught
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });
});

// ===========================================================================
// runTcpCheck
// ===========================================================================
describe('runTcpCheck', () => {
  it('returns up when socket emits connect', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const promise = runTcpCheck('example.com', 443, 10);
    // emit connect on next tick
    setImmediate(() => socket.emit('connect'));
    const result = await promise;

    expect(result.status).toBe('up');
    expect(result.errorCode).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns down with connection_refused on ECONNREFUSED', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const promise = runTcpCheck('example.com', 9999, 10);
    setImmediate(() => socket.emit('error', Object.assign(new Error('ECONNREFUSED 1.2.3.4:9999'), {})));
    const result = await promise;

    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('connection_refused');
  });

  it('returns down with dns_error on ENOTFOUND', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const promise = runTcpCheck('missing.invalid', 80, 10);
    setImmediate(() => socket.emit('error', new Error('ENOTFOUND missing.invalid')));
    const result = await promise;

    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('dns_error');
  });

  it('returns down with unexpected for unrecognized socket errors', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    const promise = runTcpCheck('example.com', 80, 10);
    setImmediate(() => socket.emit('error', new Error('some weird TCP error')));
    const result = await promise;

    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('unexpected');
  });

  it('returns down with timeout when socket times out', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeFakeSocket();
    createConnectionMock.mockReturnValue(socket);

    // Use 0.001 s (1 ms) timeout so the real setTimeout fires immediately.
    // The socket never emits 'connect' or 'error', so the timer wins.
    const result = await runTcpCheck('example.com', 443, 0.001);

    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('timeout');
  }, 5000);

  it('returns blocked when resolveAndValidateHost throws SsrfBlockedError', async () => {
    resolveAndValidateMock.mockRejectedValue(new SsrfBlockedError('private address'));
    const result = await runTcpCheck('10.0.0.1', 22, 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('blocked');
  });

  it('returns blocked when resolveAndValidateHost rejects with a generic error', async () => {
    resolveAndValidateMock.mockRejectedValue(new Error('cannot resolve'));
    const result = await runTcpCheck('internal.host', 22, 10);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('blocked');
  });
});

// ===========================================================================
// runHeartbeatCheck  (real test DB)
// ===========================================================================
describe('runHeartbeatCheck', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let monitorId: string;

  beforeEach(async () => {
    ctx = await createTestContext();

    // Create a monitor row so FK constraints are satisfied
    const monitor = await db
      .insertInto('monitors')
      .values({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        name: 'hb-test',
        type: 'heartbeat',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    monitorId = monitor.id;
  });

  it('returns up when a recent heartbeat exists', async () => {
    // Insert a heartbeat result just now
    await db
      .insertInto('monitor_results')
      .values({
        monitor_id: monitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: 'up',
        is_heartbeat: true,
        response_time_ms: null,
        status_code: null,
        error_code: null,
        time: new Date(),
      })
      .execute();

    // intervalSeconds=60 -> graceMs=90_000 ms; heartbeat is <1s old
    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.status).toBe('up');
    expect(result.errorCode).toBeNull();
  });

  it('returns down when no heartbeat exists', async () => {
    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('no_heartbeat');
  });

  it('returns down when the only heartbeat is older than the grace window', async () => {
    // Grace = 60 * 1.5 * 1000 = 90000 ms; insert a result from 2 minutes ago
    const old = new Date(Date.now() - 2 * 60 * 1000);
    await db
      .insertInto('monitor_results')
      .values({
        monitor_id: monitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: 'up',
        is_heartbeat: true,
        response_time_ms: null,
        status_code: null,
        error_code: null,
        time: old,
      })
      .execute();

    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('no_heartbeat');
  });

  it('ignores non-heartbeat results', async () => {
    // Insert a regular (non-heartbeat) result
    await db
      .insertInto('monitor_results')
      .values({
        monitor_id: monitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: 'up',
        is_heartbeat: false,
        response_time_ms: 50,
        status_code: 200,
        error_code: null,
        time: new Date(),
      })
      .execute();

    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.status).toBe('down'); // no heartbeat rows
  });

  it('ignores heartbeat results with status=down', async () => {
    await db
      .insertInto('monitor_results')
      .values({
        monitor_id: monitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: 'down',
        is_heartbeat: true,
        response_time_ms: null,
        status_code: null,
        error_code: 'timeout',
        time: new Date(),
      })
      .execute();

    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.status).toBe('down');
  });

  it('returns responseTimeMs null and statusCode null when up', async () => {
    await db
      .insertInto('monitor_results')
      .values({
        monitor_id: monitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: 'up',
        is_heartbeat: true,
        response_time_ms: null,
        status_code: null,
        error_code: null,
        time: new Date(),
      })
      .execute();

    const result = await runHeartbeatCheck(monitorId, 60, db);
    expect(result.responseTimeMs).toBeNull();
    expect(result.statusCode).toBeNull();
  });
});

// ===========================================================================
// runLogHeartbeatCheck  (real reservoir)
// ===========================================================================
describe('runLogHeartbeatCheck', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  it('returns up when a recent log from the service exists', async () => {
    // Ingest a log via the reservoir so it can be queried back
    await reservoir.ingest([
      {
        projectId: ctx.project.id,
        service: 'heartbeat-svc',
        level: 'info',
        message: 'heartbeat ping',
        time: new Date().toISOString(),
        metadata: null,
        traceId: null,
        spanId: null,
        sessionId: null,
      },
    ]);

    // graceSeconds=60 -> graceMs=60000; log is <1s old
    const result = await runLogHeartbeatCheck('heartbeat-svc', ctx.project.id, 60, reservoir);
    expect(result.status).toBe('up');
    expect(result.errorCode).toBeNull();
  });

  it('returns down when no log from the service exists within the grace window', async () => {
    // No logs seeded for this service
    const result = await runLogHeartbeatCheck('ghost-svc', ctx.project.id, 60, reservoir);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('no_heartbeat');
  });

  it('returns down when logs exist but are older than the grace window', async () => {
    // Ingest a log with a timestamp well before the grace window (2 minutes ago)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await reservoir.ingest([
      {
        projectId: ctx.project.id,
        service: 'old-svc',
        level: 'info',
        message: 'old heartbeat',
        time: twoMinAgo,
        metadata: null,
        traceId: null,
        spanId: null,
        sessionId: null,
      },
    ]);

    // graceSeconds=30 -> grace = 30s; log is 2m old -> should be stale
    const result = await runLogHeartbeatCheck('old-svc', ctx.project.id, 30, reservoir);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('no_heartbeat');
  });

  it('returns down for a different projectId even if service name matches', async () => {
    await reservoir.ingest([
      {
        projectId: ctx.project.id,
        service: 'shared-svc',
        level: 'info',
        message: 'ping',
        time: new Date().toISOString(),
        metadata: null,
        traceId: null,
        spanId: null,
        sessionId: null,
      },
    ]);

    const result = await runLogHeartbeatCheck('shared-svc', '00000000-0000-0000-0000-000000000000', 60, reservoir);
    expect(result.status).toBe('down');
  });
});

// ===========================================================================
// parseHostPort / isValidDnsHostname
// ===========================================================================
describe('parseHostPort', () => {
  it('defaults to 443', () => {
    expect(parseHostPort('example.com', 443)).toEqual({ host: 'example.com', port: 443 });
  });

  it('handles host:port, [::1]:8443 and a trailing dot', () => {
    expect(parseHostPort('example.com:8443', 443)).toEqual({ host: 'example.com', port: 8443 });
    expect(parseHostPort('[::1]:8443', 443)).toEqual({ host: '::1', port: 8443 });
    expect(parseHostPort('[::1]', 443)).toEqual({ host: '::1', port: 443 });
    expect(parseHostPort('example.com.', 443)).toEqual({ host: 'example.com', port: 443 });
    expect(parseHostPort('example.com.:993', 443)).toEqual({ host: 'example.com', port: 993 });
  });

  it('throws for port 0 and 70000', () => {
    expect(() => parseHostPort('example.com:0', 443)).toThrow();
    expect(() => parseHostPort('example.com:70000', 443)).toThrow();
    expect(() => parseHostPort('example.com:abc', 443)).toThrow();
    expect(() => parseHostPort('', 443)).toThrow();
  });
});

describe('isValidDnsHostname', () => {
  it('rejects 10.0.0.1, host:53 and empty labels', () => {
    expect(isValidDnsHostname('10.0.0.1')).toBe(false);
    expect(isValidDnsHostname('::1')).toBe(false);
    expect(isValidDnsHostname('example.com:53')).toBe(false);
    expect(isValidDnsHostname('a..example.com')).toBe(false);
    expect(isValidDnsHostname('')).toBe(false);
    expect(isValidDnsHostname('exa mple.com')).toBe(false);
  });

  it('accepts regular and underscore names and one trailing dot', () => {
    expect(isValidDnsHostname('example.com')).toBe(true);
    expect(isValidDnsHostname('example.com.')).toBe(true);
    expect(isValidDnsHostname('_dmarc.example.com')).toBe(true);
    expect(isValidDnsHostname('localhost')).toBe(true);
  });
});

// ===========================================================================
// runSslCheck
// ===========================================================================
function makeTlsSocket(opts: {
  validTo: Date;
  authorized?: boolean;
  authorizationError?: string | null;
  noCert?: boolean;
}) {
  const socket = new EventEmitter() as EventEmitter & Record<string, any>;
  socket.destroy = vi.fn();
  socket.authorized = opts.authorized ?? true;
  socket.authorizationError = opts.authorizationError ?? null;
  socket.getPeerCertificate = () =>
    opts.noCert
      ? {}
      : {
          valid_to: opts.validTo.toUTCString(),
          issuer: { O: 'Test CA', CN: 'Test CA R1' },
          subject: { CN: 'example.com' },
        };
  return socket;
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000 + 3600000);

describe('runSslCheck', () => {
  it('is up with detail.daysRemaining 40 for a cert valid 40 more days (warnDays 14)', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeTlsSocket({ validTo: daysFromNow(40) });
    tlsConnectMock.mockReturnValue(socket);

    const promise = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() => socket.emit('secureConnect'));
    const result = await promise;

    expect(result.status).toBe('up');
    expect(result.errorCode).toBeNull();
    expect(result.detail).toMatchObject({ daysRemaining: 40, issuer: 'Test CA', subject: 'example.com' });
    expect(typeof (result.detail as any).expiresAt).toBe('string');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('is down cert_expiring with daysRemaining 10 when warnDays is 14', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeTlsSocket({ validTo: daysFromNow(10) });
    tlsConnectMock.mockReturnValue(socket);

    const promise = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() => socket.emit('secureConnect'));
    const result = await promise;

    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('cert_expiring');
    expect((result.detail as any).daysRemaining).toBe(10);
  });

  it('is down cert_expired for a past validTo or authorizationError CERT_HAS_EXPIRED', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);

    const past = makeTlsSocket({ validTo: daysFromNow(-3) });
    tlsConnectMock.mockReturnValueOnce(past);
    const p1 = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() => past.emit('secureConnect'));
    expect((await p1).errorCode).toBe('cert_expired');

    const flagged = makeTlsSocket({
      validTo: daysFromNow(30),
      authorized: false,
      authorizationError: 'CERT_HAS_EXPIRED',
    });
    tlsConnectMock.mockReturnValueOnce(flagged);
    const p2 = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() => flagged.emit('secureConnect'));
    expect((await p2).errorCode).toBe('cert_expired');
  });

  it('maps other authorizationError values to ssl_error', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    for (const authorizationError of [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ]) {
      const socket = makeTlsSocket({ validTo: daysFromNow(60), authorized: false, authorizationError });
      tlsConnectMock.mockReturnValueOnce(socket);
      const p = runSslCheck('example.com', 443, 10, 14);
      setImmediate(() => socket.emit('secureConnect'));
      const result = await p;
      expect(result.status).toBe('down');
      expect(result.errorCode).toBe('ssl_error');
    }
  });

  it('returns ssl_error when the peer presents no certificate', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeTlsSocket({ validTo: daysFromNow(60), noCert: true });
    tlsConnectMock.mockReturnValue(socket);
    const p = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() => socket.emit('secureConnect'));
    expect((await p).errorCode).toBe('ssl_error');
  });

  it('returns blocked and never calls tls.connect for a private address when allowPrivate is false', async () => {
    resolveAndValidateMock.mockRejectedValue(new SsrfBlockedError('private address'));
    const result = await runSslCheck('10.0.0.5', 443, 10, 14, false);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('blocked');
    expect(tlsConnectMock).not.toHaveBeenCalled();
    expect(resolveAndValidateMock).toHaveBeenCalledWith('10.0.0.5', false);
  });

  it('connects to the validated address with servername equal to the hostname', async () => {
    resolveAndValidateMock.mockResolvedValue(['93.184.216.34']);
    const socket = makeTlsSocket({ validTo: daysFromNow(40) });
    tlsConnectMock.mockReturnValue(socket);

    const promise = runSslCheck('example.com', 8443, 10, 14);
    setImmediate(() => socket.emit('secureConnect'));
    await promise;

    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
    expect(tlsConnectMock.mock.calls[0][0]).toMatchObject({
      host: '93.184.216.34',
      port: 8443,
      servername: 'example.com',
      rejectUnauthorized: false,
    });
  });

  it('returns timeout and destroys the socket', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeTlsSocket({ validTo: daysFromNow(40) });
    tlsConnectMock.mockReturnValue(socket);

    const result = await runSslCheck('example.com', 443, 0.001, 14);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('timeout');
    expect(socket.destroy).toHaveBeenCalled();
  }, 5000);

  it('maps ECONNREFUSED to connection_refused', async () => {
    resolveAndValidateMock.mockResolvedValue(['1.2.3.4']);
    const socket = makeTlsSocket({ validTo: daysFromNow(40) });
    tlsConnectMock.mockReturnValue(socket);
    const p = runSslCheck('example.com', 443, 10, 14);
    setImmediate(() =>
      socket.emit('error', Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }))
    );
    const result = await p;
    expect(result.errorCode).toBe('connection_refused');
  });
});

// ===========================================================================
// runDnsCheck
// ===========================================================================
function resolverReturning(value: unknown) {
  const resolve = vi.fn().mockResolvedValue(value);
  return { factory: () => ({ resolve }) as any, resolve };
}

function resolverFailing(code: string) {
  const resolve = vi.fn().mockRejectedValue(Object.assign(new Error(`query ${code}`), { code }));
  return { factory: () => ({ resolve }) as any, resolve };
}

describe('runDnsCheck', () => {
  it('is up when an A record exists and no expected value', async () => {
    const r = resolverReturning(['93.184.216.34']);
    const result = await runDnsCheck('example.com', 'A', undefined, 5, r.factory);
    expect(result.status).toBe('up');
    expect(result.errorCode).toBeNull();
    expect(result.detail).toEqual({ records: ['93.184.216.34'] });
    expect(r.resolve).toHaveBeenCalledWith('example.com', 'A');
  });

  it('matches a CNAME expected value case-insensitively ignoring the trailing dot', async () => {
    const r = resolverReturning(['Target.Example.NET.']);
    const result = await runDnsCheck('www.example.com', 'CNAME', 'target.example.net', 5, r.factory);
    expect(result.status).toBe('up');
  });

  it('compares MX by exchange host and ignores priority', async () => {
    const r = resolverReturning([
      { exchange: 'mx1.example.com', priority: 10 },
      { exchange: 'mx2.example.com', priority: 20 },
    ]);
    const result = await runDnsCheck('example.com', 'MX', 'MX2.example.com.', 5, r.factory);
    expect(result.status).toBe('up');
    expect((result.detail as any).records).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  it('joins TXT chunks before comparing', async () => {
    const r = resolverReturning([['v=spf1 include:', '_spf.example.com ~all'], ['other']]);
    const result = await runDnsCheck('example.com', 'TXT', 'v=spf1 include:_spf.example.com ~all', 5, r.factory);
    expect(result.status).toBe('up');
  });

  it('is down dns_mismatch when the expected value is absent', async () => {
    const r = resolverReturning(['1.1.1.1']);
    const result = await runDnsCheck('example.com', 'A', '2.2.2.2', 5, r.factory);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('dns_mismatch');
    expect((result.detail as any).records).toEqual(['1.1.1.1']);
  });

  it('is down dns_no_records for an empty answer', async () => {
    const r = resolverReturning([]);
    const result = await runDnsCheck('example.com', 'A', undefined, 5, r.factory);
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('dns_no_records');
  });

  it('is down dns_error for ENOTFOUND and ENODATA', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const r = resolverFailing(code);
      const result = await runDnsCheck('missing.example.com', 'A', undefined, 5, r.factory);
      expect(result.status).toBe('down');
      expect(result.errorCode).toBe('dns_error');
    }
  });

  it('is down timeout for ETIMEOUT', async () => {
    const r = resolverFailing('ETIMEOUT');
    const result = await runDnsCheck('example.com', 'A', undefined, 5, r.factory);
    expect(result.errorCode).toBe('timeout');
  });

  it('caps the stored records at 20 entries', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`);
    const r = resolverReturning(many);
    const result = await runDnsCheck('example.com', 'A', undefined, 5, r.factory, true);
    expect((result.detail as any).records).toHaveLength(20);
  });

  it('refuses single-label and internal-suffix names without asking the resolver', async () => {
    for (const name of ['postgres', 'logtide-billing', 'kubernetes.default.svc', 'db.internal', 'host.local']) {
      const r = resolverReturning(['172.18.0.2']);
      const result = await runDnsCheck(name, 'A', undefined, 5, r.factory);
      expect(result.status).toBe('down');
      expect(result.errorCode).toBe('blocked');
      expect(result.detail).toBeUndefined();
      expect(r.resolve).not.toHaveBeenCalled();
    }
  });

  it('does not store A/AAAA answers in private ranges', async () => {
    const a = await runDnsCheck('example.com', 'A', undefined, 5, resolverReturning(['93.184.216.34', '10.0.0.5']).factory);
    expect(a.errorCode).toBe('blocked');
    expect(a.detail).toBeUndefined();
    const aaaa = await runDnsCheck('example.com', 'AAAA', undefined, 5, resolverReturning(['fd00::1']).factory);
    expect(aaaa.errorCode).toBe('blocked');
  });

  it('allows internal names and private answers when MONITOR_ALLOW_PRIVATE_TARGETS is on', async () => {
    const r = resolverReturning(['172.18.0.2']);
    const result = await runDnsCheck('postgres', 'A', undefined, 5, r.factory, true);
    expect(result.status).toBe('up');
    expect(result.detail).toEqual({ records: ['172.18.0.2'] });
  });
});

// ===========================================================================
// runHttpCheck: default expected status
// ===========================================================================
describe('runHttpCheck expected status default', () => {
  it('is up for 204 and down for 500 when expectedStatus is unset', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(204));
    expect((await runHttpCheck('https://example.com', 10)).status).toBe('up');
    safeFetchMock.mockResolvedValue(makeResponse(500));
    expect((await runHttpCheck('https://example.com', 10)).status).toBe('down');
    safeFetchMock.mockResolvedValue(makeResponse(301));
    expect((await runHttpCheck('https://example.com', 10)).status).toBe('down');
  });

  it('keeps exact matching when expectedStatus is 200 and the response is 204', async () => {
    safeFetchMock.mockResolvedValue(makeResponse(204));
    const result = await runHttpCheck('https://example.com', 10, { expectedStatus: 200 });
    expect(result.status).toBe('down');
    expect(result.errorCode).toBe('http_error');
  });
});
