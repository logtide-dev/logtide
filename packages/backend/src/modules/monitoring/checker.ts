import { createConnection, isIP } from 'net';
import { connect as tlsConnect } from 'tls';
import dns from 'dns';
import type { Kysely } from 'kysely';
import isSafeRegex from 'safe-regex2';
import type { Database } from '../../database/types.js';
import type { IReservoir } from '@logtide/reservoir';
import type { CheckResult, HttpConfig, ErrorCode, DnsCheckConfig } from './types.js';
import { safeFetch, resolveAndValidateHost, SsrfBlockedError } from '../../utils/ssrf-guard.js';

/**
 * HTTP/HTTPS health check.
 * Never surfaces raw error messages - maps all failures to sanitized error codes.
 *
 * allowPrivate lets self-hosted deployments monitor internal services; when
 * false (default) the target and every redirect hop are validated against the
 * SSRF guard before connecting.
 */
export async function runHttpCheck(
  target: string,
  timeoutSeconds: number,
  config: HttpConfig = {},
  allowPrivate = false
): Promise<CheckResult> {
  // Unset expectedStatus means "any 2xx"; an explicit value stays exact.
  const { method = 'GET', expectedStatus, headers = {}, bodyAssertion } = config;
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await safeFetch(
      target,
      {
        method,
        headers: { 'User-Agent': 'LogTide-Monitor/1.0', ...headers },
        signal: controller.signal,
      },
      { allowPrivate }
    );

    const responseTimeMs = Date.now() - start;
    const statusCode = response.status;

    const statusOk =
      expectedStatus === undefined || expectedStatus === null
        ? statusCode >= 200 && statusCode < 300
        : statusCode === expectedStatus;
    if (!statusOk) {
      return { status: 'down', responseTimeMs, statusCode, errorCode: 'http_error' };
    }

    if (bodyAssertion) {
      const body = await response.text();
      let passes: boolean;
      if (bodyAssertion.type === 'contains') {
        passes = body.includes(bodyAssertion.value);
      } else {
        // Limit body size and pattern length to mitigate ReDoS, and reject
        // patterns flagged as unsafe by safe-regex2 (catastrophic backtracking).
        const safeBody = body.slice(0, 10000);
        const safePattern = bodyAssertion.pattern.slice(0, 256);
        if (!isSafeRegex(safePattern)) {
          return { status: 'down', responseTimeMs, statusCode, errorCode: 'http_error' };
        }
        try {
          passes = new RegExp(safePattern).test(safeBody); // lgtm[js/regex-injection] - validated by isSafeRegex above
        } catch {
          return { status: 'down', responseTimeMs, statusCode, errorCode: 'http_error' };
        }
      }

      if (!passes) {
        return { status: 'down', responseTimeMs, statusCode, errorCode: 'http_error' };
      }
    }


    return { status: 'up', responseTimeMs, statusCode, errorCode: null };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : '';
    let errorCode: ErrorCode;

    if (err instanceof SsrfBlockedError) {
      errorCode = 'blocked';
    } else if (err instanceof Error && err.name === 'AbortError') {
      errorCode = 'timeout';
    } else if (msg.includes('ECONNREFUSED')) {
      errorCode = 'connection_refused';
    } else if (msg.includes('ENOTFOUND') || msg.includes('EAI_')) {
      errorCode = 'dns_error';
    } else if (msg.includes('SSL') || msg.includes('certificate') || msg.includes('CERT_')) {
      errorCode = 'ssl_error';
    } else {
      errorCode = 'unexpected';
    }

    return { status: 'down', responseTimeMs, statusCode: null, errorCode };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TCP connectivity check - measures time to establish connection.
 *
 * The host is resolved and validated against the SSRF guard, then the socket is
 * pinned to the validated address so a hostname can't rebind to an internal IP
 * between validation and connect.
 */
export async function runTcpCheck(
  host: string,
  port: number,
  timeoutSeconds: number,
  allowPrivate = false
): Promise<CheckResult> {
  const start = Date.now();

  let connectHost: string;
  try {
    const [address] = await resolveAndValidateHost(host, allowPrivate);
    connectHost = address;
  } catch {
    return { status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode: 'blocked' };
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host: connectHost, port });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode: 'timeout' });
    }, timeoutSeconds * 1000);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ status: 'up', responseTimeMs: Date.now() - start, statusCode: null, errorCode: null });
    });

    socket.on('error', (err: Error) => {
      clearTimeout(timer);
      const msg = err.message;
      let errorCode: ErrorCode = 'unexpected';
      if (msg.includes('ECONNREFUSED')) errorCode = 'connection_refused';
      else if (msg.includes('ENOTFOUND') || msg.includes('EAI_')) errorCode = 'dns_error';
      resolve({ status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode });
    });
  });
}

/**
 * Heartbeat check - looks for a recent heartbeat ping in monitor_results.
 * Returns 'up' if a heartbeat was received within the grace window (interval * 1.5).
 */
export async function runHeartbeatCheck(
  monitorId: string,
  intervalSeconds: number,
  db: Kysely<Database>
): Promise<CheckResult> {
  const graceMs = intervalSeconds * 1.5 * 1000;
  const since = new Date(Date.now() - graceMs);

  const recent = await db
    .selectFrom('monitor_results')
    .select('time')
    .where('monitor_id', '=', monitorId)
    .where('is_heartbeat', '=', true)
    .where('status', '=', 'up')
    .where('time', '>=', since)
    .orderBy('time', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (recent) {
    return { status: 'up', responseTimeMs: null, statusCode: null, errorCode: null };
  }

  return { status: 'down', responseTimeMs: null, statusCode: null, errorCode: 'no_heartbeat' };
}

/**
 * Log-based heartbeat check - queries the reservoir for the last log from a service.
 * Returns 'up' if a log was received within the grace window (interval * 1.5).
 * Works across all storage engines (TimescaleDB, ClickHouse, MongoDB).
 */
export async function runLogHeartbeatCheck(
  serviceName: string,
  projectId: string,
  graceSeconds: number,
  reservoir: IReservoir
): Promise<CheckResult> {
  const graceMs = graceSeconds * 1000;
  const since = new Date(Date.now() - graceMs);

  const result = await reservoir.query({
    projectId,
    service: serviceName,
    from: since,
    to: new Date(),
    limit: 1,
    sortBy: 'time',
    sortOrder: 'desc',
  });

  if (result.logs.length > 0) {
    return { status: 'up', responseTimeMs: null, statusCode: null, errorCode: null };
  }

  return { status: 'down', responseTimeMs: null, statusCode: null, errorCode: 'no_heartbeat' };
}

/**
 * Parse "host:port" string for TCP monitors.
 * Handles IPv6 addresses like "[::1]:5432".
 */
export function parseTcpTarget(target: string): { host: string; port: number } {
  // IPv6 with brackets: [::1]:5432
  const ipv6Match = target.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6Match) {
    return { host: ipv6Match[1], port: parseInt(ipv6Match[2], 10) };
  }
  // Standard host:port
  const lastColon = target.lastIndexOf(':');
  if (lastColon === -1) throw new Error('TCP target must be host:port');
  return {
    host: target.slice(0, lastColon),
    port: parseInt(target.slice(lastColon + 1), 10),
  };
}

/**
 * Parse "host", "host:port" or "[v6]:port" with a default port (SSL monitors).
 * Strips one trailing dot from the host. Throws on a port outside 1..65535.
 */
export function parseHostPort(target: string, defaultPort: number): { host: string; port: number } {
  const trimmed = target.trim();
  if (!trimmed) throw new Error('Target must not be empty');

  let host: string;
  let portText: string | null = null;

  const bracket = trimmed.match(/^\[([^\]]+)\](?::(.*))?$/);
  if (bracket) {
    host = bracket[1];
    portText = bracket[2] ?? null;
  } else if ((trimmed.match(/:/g) ?? []).length > 1) {
    // Bare IPv6 literal without brackets: no port can be expressed
    host = trimmed;
  } else {
    const idx = trimmed.lastIndexOf(':');
    if (idx === -1) {
      host = trimmed;
    } else {
      host = trimmed.slice(0, idx);
      portText = trimmed.slice(idx + 1);
    }
  }

  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) throw new Error('Target host must not be empty');

  let port = defaultPort;
  if (portText !== null) {
    if (!/^\d{1,5}$/.test(portText)) throw new Error('Invalid port');
    port = parseInt(portText, 10);
    if (port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  }

  return { host, port };
}

/**
 * Strict hostname check for DNS monitors: no IP literals, no port, no scheme.
 * One trailing dot is tolerated. Underscores are allowed (_dmarc, _acme-challenge).
 */
export function isValidDnsHostname(name: string): boolean {
  if (typeof name !== 'string') return false;
  const bare = name.endsWith('.') ? name.slice(0, -1) : name;
  if (bare.length === 0 || bare.length > 253) return false;
  if (isIP(bare) !== 0) return false;
  const labels = bare.split('.');
  return labels.every((label) => /^[A-Za-z0-9_]([A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label));
}

function certName(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as Record<string, unknown>;
  const v = f.O ?? f.CN;
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

function certCommonName(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const v = (field as Record<string, unknown>).CN;
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

/**
 * SSL certificate check. Up only when the handshake succeeds, the chain is
 * trusted, the hostname matches and at least warnDays remain on the certificate.
 *
 * Same SSRF policy as TCP: the host is validated first and the socket is pinned
 * to the validated address; SNI and hostname verification use the original name.
 */
export async function runSslCheck(
  host: string,
  port: number,
  timeoutSeconds: number,
  warnDays: number,
  allowPrivate = false
): Promise<CheckResult> {
  const start = Date.now();

  let address: string;
  try {
    [address] = await resolveAndValidateHost(host, allowPrivate);
  } catch {
    return { status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode: 'blocked' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const socket = tlsConnect({
      host: address,
      port,
      // IP literals have no SNI; the handshake then verifies against the address itself.
      ...(isIP(host) === 0 ? { servername: host } : {}),
      rejectUnauthorized: false,
    });

    const timer = setTimeout(() => {
      socket.destroy();
      finish({ status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode: 'timeout' });
    }, timeoutSeconds * 1000);

    socket.on('secureConnect', () => {
      const responseTimeMs = Date.now() - start;
      let result: CheckResult;
      try {
        const cert = socket.getPeerCertificate() as unknown as Record<string, unknown>;
        const validTo = typeof cert?.valid_to === 'string' ? new Date(cert.valid_to) : null;
        if (!cert || !validTo || Number.isNaN(validTo.getTime())) {
          result = { status: 'down', responseTimeMs, statusCode: null, errorCode: 'ssl_error' };
        } else {
          const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86400000);
          const detail = {
            expiresAt: validTo.toISOString(),
            daysRemaining,
            issuer: certName(cert.issuer),
            subject: certCommonName(cert.subject),
          };
          const authError = socket.authorizationError ? String(socket.authorizationError) : null;
          let errorCode: ErrorCode | null = null;
          if (validTo.getTime() < Date.now() || authError === 'CERT_HAS_EXPIRED') errorCode = 'cert_expired';
          else if (!socket.authorized || authError) errorCode = 'ssl_error';
          else if (daysRemaining < warnDays) errorCode = 'cert_expiring';
          result = {
            status: errorCode ? 'down' : 'up',
            responseTimeMs,
            statusCode: null,
            errorCode,
            detail,
          };
        }
      } catch {
        result = { status: 'down', responseTimeMs, statusCode: null, errorCode: 'ssl_error' };
      }
      socket.destroy();
      finish(result);
    });

    socket.on('error', (err: Error & { code?: string }) => {
      socket.destroy();
      const code = err.code ?? '';
      const msg = err.message ?? '';
      let errorCode: ErrorCode = 'unexpected';
      if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) errorCode = 'connection_refused';
      else if (code === 'ENOTFOUND' || code.startsWith('EAI_') || msg.includes('ENOTFOUND')) errorCode = 'dns_error';
      else if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) errorCode = 'timeout';
      else if (
        code.startsWith('ERR_SSL') ||
        code.startsWith('ERR_TLS') ||
        code.startsWith('CERT_') ||
        /ssl|tls|certificate|handshake/i.test(msg)
      ) {
        errorCode = 'ssl_error';
      }
      finish({ status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode });
    });
  });
}

type DnsResolverLike = Pick<dns.promises.Resolver, 'resolve'>;

function stripDot(value: string): string {
  return (value.endsWith('.') ? value.slice(0, -1) : value).toLowerCase();
}

/** Flatten any resolver answer into comparable strings (MX by exchange, TXT chunks joined). */
function normalizeDnsRecords(recordType: DnsCheckConfig['recordType'], answer: unknown): string[] {
  const items = Array.isArray(answer) ? answer : [];
  switch (recordType) {
    case 'MX':
      return items
        .map((r) => (r && typeof r === 'object' ? String((r as { exchange?: unknown }).exchange ?? '') : ''))
        .filter(Boolean)
        .map(stripDot);
    case 'TXT':
      return items.map((r) => (Array.isArray(r) ? r.join('') : String(r)));
    case 'CNAME':
      return items.map((r) => stripDot(String(r)));
    default:
      return items.map((r) => String(r).toLowerCase());
  }
}

/**
 * DNS record check. Queries only the configured resolver and never connects
 * to the answers, so no SSRF surface exists beyond the hostname pattern.
 */
export async function runDnsCheck(
  hostname: string,
  recordType: DnsCheckConfig['recordType'],
  expectedValue: string | undefined,
  timeoutSeconds: number,
  resolverFactory: (timeoutMs: number) => DnsResolverLike = (timeoutMs) =>
    new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 })
): Promise<CheckResult> {
  const start = Date.now();
  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;

  try {
    const resolver = resolverFactory(Math.max(1, Math.round(timeoutSeconds * 1000)));
    const answer = await (resolver.resolve as (n: string, t: string) => Promise<unknown>)(name, recordType);
    const responseTimeMs = Date.now() - start;
    const records = normalizeDnsRecords(recordType, answer);
    const detail = { records: records.slice(0, 20) };

    if (records.length === 0) {
      return { status: 'down', responseTimeMs, statusCode: null, errorCode: 'dns_no_records', detail };
    }

    const expected = expectedValue?.trim();
    if (expected) {
      const wanted = recordType === 'TXT' ? expected : stripDot(expected);
      if (!records.includes(wanted)) {
        return { status: 'down', responseTimeMs, statusCode: null, errorCode: 'dns_mismatch', detail };
      }
    }

    return { status: 'up', responseTimeMs, statusCode: null, errorCode: null, detail };
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code ?? '';
    let errorCode: ErrorCode = 'dns_error';
    if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') errorCode = 'timeout';
    return { status: 'down', responseTimeMs: Date.now() - start, statusCode: null, errorCode };
  }
}
