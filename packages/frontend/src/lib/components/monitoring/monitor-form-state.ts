import type {
  CreateMonitorInput,
  DnsRecordType,
  HttpConfig,
  Monitor,
  MonitorType,
} from '$lib/api/monitoring';

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export const DNS_RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
export const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export const MAX_HEADERS = 20;

export type BodyAssertionKind = 'none' | 'contains' | 'regex';

export interface HeaderRow {
  name: string;
  value: string;
}

/** Every numeric input is a string so a cleared field is never NaN. */
export interface MonitorFormValues {
  name: string;
  type: MonitorType;
  target: string;
  intervalSeconds: string;
  timeoutSeconds: string;
  failureThreshold: string;
  gracePeriodSeconds: string;
  autoResolve: boolean;
  enabled: boolean;
  severity: string;
  method: string;
  expectedStatus: string;
  headers: HeaderRow[];
  bodyAssertionKind: BodyAssertionKind;
  bodyAssertionValue: string;
  warnDays: string;
  recordType: DnsRecordType;
  expectedValue: string;
  displayName: string;
  groupName: string;
}

export function defaultValues(type: MonitorType): MonitorFormValues {
  const base: MonitorFormValues = {
    name: '',
    type,
    target: '',
    intervalSeconds: '60',
    timeoutSeconds: '10',
    failureThreshold: '2',
    gracePeriodSeconds: '',
    autoResolve: true,
    enabled: true,
    severity: 'high',
    method: 'GET',
    expectedStatus: '',
    headers: [],
    bodyAssertionKind: 'none',
    bodyAssertionValue: '',
    warnDays: '14',
    recordType: 'A',
    expectedValue: '',
    displayName: '',
    groupName: '',
  };
  if (type === 'ssl') return { ...base, intervalSeconds: '3600', failureThreshold: '1' };
  if (type === 'dns') return { ...base, intervalSeconds: '300' };
  return base;
}

export function valuesFromMonitor(m: Monitor, mode: 'edit' | 'duplicate'): MonitorFormValues {
  const v = defaultValues(m.type);
  const http = m.httpConfig;
  const ssl = m.type === 'ssl' ? (m.checkConfig as { warnDays?: number } | null) : null;
  const dns =
    m.type === 'dns' ? (m.checkConfig as { recordType?: DnsRecordType; expectedValue?: string } | null) : null;

  const values: MonitorFormValues = {
    ...v,
    name: mode === 'duplicate' ? `${m.name} (copy)` : m.name,
    target: m.target ?? '',
    intervalSeconds: String(m.intervalSeconds),
    timeoutSeconds: String(m.timeoutSeconds),
    failureThreshold: String(m.failureThreshold),
    gracePeriodSeconds: m.gracePeriodSeconds != null ? String(m.gracePeriodSeconds) : '',
    autoResolve: m.autoResolve,
    enabled: m.enabled,
    severity: m.severity,
    // The public identity belongs to the original; a copy starts without it.
    displayName: mode === 'duplicate' ? '' : (m.displayName ?? ''),
    groupName: m.groupName ?? '',
  };

  if (http) {
    values.method = (http.method ?? 'GET').toUpperCase();
    values.expectedStatus = http.expectedStatus != null ? String(http.expectedStatus) : '';
    values.headers = Object.entries(http.headers ?? {}).map(([name, value]) => ({ name, value }));
    if (http.bodyAssertion?.type === 'contains') {
      values.bodyAssertionKind = 'contains';
      values.bodyAssertionValue = http.bodyAssertion.value;
    } else if (http.bodyAssertion?.type === 'regex') {
      values.bodyAssertionKind = 'regex';
      values.bodyAssertionValue = http.bodyAssertion.pattern;
    }
  }
  if (ssl?.warnDays != null) values.warnDays = String(ssl.warnDays);
  if (dns) {
    if (dns.recordType) values.recordType = dns.recordType;
    values.expectedValue = dns.expectedValue ?? '';
  }
  return values;
}

/** Strict integer parse: blank or non-numeric text is NaN, never 0. */
export function parseIntField(raw: string): number {
  const t = String(raw ?? '').trim();
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
}

function inRange(raw: string, min: number, max: number): boolean {
  const n = parseIntField(raw);
  return Number.isFinite(n) && n >= min && n <= max;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME = /^(?=.{1,253}\.?$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

export function isHostnameNotIp(name: string): boolean {
  const t = name.trim();
  if (!t || IPV4.test(t) || t.includes(':')) return false;
  return HOSTNAME.test(t);
}

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

export function hasProbeFields(type: MonitorType): boolean {
  return type !== 'heartbeat' && type !== 'log_heartbeat';
}

/** Returns an error message per invalid field, keyed by field name. Empty means valid. */
export function validateMonitorForm(v: MonitorFormValues, editing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  const target = v.target.trim();

  if (!v.name.trim()) errors.name = 'Enter a name';
  else if (v.name.length > 255) errors.name = 'Use 255 characters or fewer';

  if (!inRange(v.intervalSeconds, 30, 86400)) {
    errors.intervalSeconds = 'Enter a whole number between 30 and 86,400';
  }
  if (hasProbeFields(v.type) && !inRange(v.timeoutSeconds, 1, 60)) {
    errors.timeoutSeconds = 'Enter a whole number between 1 and 60';
  }
  if (!inRange(v.failureThreshold, 1, 20)) {
    errors.failureThreshold = 'Enter a whole number between 1 and 20';
  }

  if (v.type === 'log_heartbeat') {
    if (!target) errors.target = 'Enter a service name';
    if (v.gracePeriodSeconds.trim() !== '' && !inRange(v.gracePeriodSeconds, 60, 86400)) {
      errors.gracePeriodSeconds = 'Enter a whole number between 60 and 86,400';
    }
  }

  if (v.type === 'http') {
    if (!target) errors.target = 'Enter a URL';
    else if (!editing && !/^https?:\/\//i.test(target)) errors.target = 'The URL must start with http:// or https://';
    if (v.expectedStatus.trim() !== '' && !inRange(v.expectedStatus, 100, 599)) {
      errors.expectedStatus = 'Enter a status code between 100 and 599';
    }
    const named = v.headers.filter((h) => h.name.trim() || h.value.trim());
    if (named.length > MAX_HEADERS) errors.headers = `Use ${MAX_HEADERS} headers or fewer`;
    else if (named.some((h) => !HEADER_NAME.test(h.name.trim()))) {
      errors.headers = 'Header names can use letters, numbers and hyphens only';
    } else if (named.some((h) => h.value.length > 1024)) {
      errors.headers = 'Header values must be 1,024 characters or fewer';
    }
    if (v.bodyAssertionKind === 'regex' && v.bodyAssertionValue) {
      try {
        new RegExp(v.bodyAssertionValue);
      } catch {
        errors.bodyAssertionValue = 'Enter a valid regular expression';
      }
    }
    if (v.bodyAssertionKind !== 'none' && !v.bodyAssertionValue) {
      errors.bodyAssertionValue = 'Enter the text to look for';
    }
  }

  if (v.type === 'tcp') {
    if (!target) errors.target = 'Enter host:port';
    else if (!editing && !/^.+:\d{1,5}$/.test(target)) errors.target = 'Use the host:port format';
  }

  if (v.type === 'ssl') {
    if (!target) errors.target = 'Enter a hostname';
    else if (target.includes('://')) errors.target = 'Enter a hostname without http:// or https://';
    if (!inRange(v.warnDays, 1, 365)) errors.warnDays = 'Enter a whole number between 1 and 365';
  }

  if (v.type === 'dns') {
    if (!target) errors.target = 'Enter a hostname';
    else if (!isHostnameNotIp(target)) errors.target = 'Enter a hostname, not an IP address or URL';
  }

  if (v.displayName.length > 255) errors.displayName = 'Use 255 characters or fewer';
  if (v.groupName.length > 100) errors.groupName = 'Use 100 characters or fewer';

  return errors;
}

export function buildHttpConfig(v: MonitorFormValues): HttpConfig {
  const config: HttpConfig = { method: v.method.toUpperCase() };
  if (v.expectedStatus.trim() !== '') config.expectedStatus = parseIntField(v.expectedStatus);
  const headers: Record<string, string> = {};
  for (const h of v.headers) {
    const name = h.name.trim();
    if (name) headers[name] = h.value;
  }
  if (Object.keys(headers).length > 0) config.headers = headers;
  if (v.bodyAssertionKind === 'contains' && v.bodyAssertionValue) {
    config.bodyAssertion = { type: 'contains', value: v.bodyAssertionValue };
  } else if (v.bodyAssertionKind === 'regex' && v.bodyAssertionValue) {
    config.bodyAssertion = { type: 'regex', pattern: v.bodyAssertionValue };
  }
  return config;
}

export function buildPayload(
  v: MonitorFormValues,
  ctx: { organizationId: string; projectId: string }
): CreateMonitorInput {
  const payload: CreateMonitorInput = {
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    name: v.name.trim(),
    type: v.type,
    target: v.type === 'heartbeat' ? null : v.target.trim() || null,
    intervalSeconds: parseIntField(v.intervalSeconds),
    failureThreshold: parseIntField(v.failureThreshold),
    gracePeriodSeconds:
      v.type === 'log_heartbeat' && v.gracePeriodSeconds.trim() !== ''
        ? parseIntField(v.gracePeriodSeconds)
        : null,
    autoResolve: v.autoResolve,
    enabled: v.enabled,
    severity: v.severity,
    displayName: v.displayName.trim() || null,
    groupName: v.groupName.trim() || null,
  };
  if (hasProbeFields(v.type)) payload.timeoutSeconds = parseIntField(v.timeoutSeconds);
  if (v.type === 'http') payload.httpConfig = buildHttpConfig(v);
  if (v.type === 'ssl') payload.checkConfig = { warnDays: parseIntField(v.warnDays) };
  if (v.type === 'dns') {
    const expected = v.expectedValue.trim();
    payload.checkConfig = {
      recordType: v.recordType,
      ...(expected ? { expectedValue: expected } : {}),
    };
  }
  return payload;
}
