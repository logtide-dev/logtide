import crypto from 'crypto';
import { config } from '../../config/index.js';
import { CapabilityError, QuotaExceededError } from '../../capabilities/errors.js';

export type UpgradeIntent = 'upgrade' | 'manage';

export interface UpgradeHandoffPayload {
  v: 1;
  org: string;
  user: string;
  email: string;
  role: string;
  intent: UpgradeIntent;
  /** Expiry as unix seconds. */
  exp: number;
  nonce: string;
}

export const UPGRADE_TOKEN_TTL_SECONDS = 10 * 60;

type UpgradeConfig = { LOGTIDE_UPGRADE_URL?: string; LOGTIDE_UPGRADE_SIGNING_SECRET?: string };

/**
 * The handoff is active only when BOTH the portal URL and the signing secret
 * are configured. Read at call time so the answer always reflects config.
 */
export function isUpgradeHandoffActive(): boolean {
  const c = config as UpgradeConfig;
  return Boolean(c.LOGTIDE_UPGRADE_URL && c.LOGTIDE_UPGRADE_SIGNING_SECRET);
}

/**
 * Body fragment for a capability (403) or quota (429) rejection: `{ upgrade_available: true }`
 * while the handoff is active, `{}` otherwise (and for every other error), so OSS
 * responses stay byte-for-byte unchanged.
 */
export function upgradeHintFor(error: unknown): { upgrade_available?: true } {
  if ((error instanceof CapabilityError || error instanceof QuotaExceededError) && isUpgradeHandoffActive()) {
    return { upgrade_available: true };
  }
  return {};
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(secret: string, encodedPayload: string): Buffer {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest();
}

/** Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url payload)). */
export function signUpgradeToken(
  input: Omit<UpgradeHandoffPayload, 'v' | 'exp' | 'nonce'>,
  secret: string,
  nowMs: number = Date.now()
): string {
  const payload: UpgradeHandoffPayload = {
    v: 1,
    ...input,
    exp: Math.floor(nowMs / 1000) + UPGRADE_TOKEN_TTL_SECONDS,
    nonce: b64url(crypto.randomBytes(16)),
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${b64url(sign(secret, encoded))}`;
}

/**
 * Reference verifier: this is the algorithm the external billing service must
 * implement. Returns the payload, or null for any malformed, tampered or
 * expired token.
 */
export function verifyUpgradeToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): UpgradeHandoffPayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, mac] = parts;

  const expected = sign(secret, encoded);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let payload: UpgradeHandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1 || typeof payload.exp !== 'number') return null;
  for (const k of ['org', 'user', 'email', 'role', 'nonce'] as const) {
    if (typeof payload[k] !== 'string' || payload[k].length === 0) return null;
  }
  if (payload.intent !== 'upgrade' && payload.intent !== 'manage') return null;
  if (payload.exp <= Math.floor(nowMs / 1000)) return null;
  return payload;
}

/** Builds the redirect URL; an existing query string on the base URL is preserved. */
export function buildUpgradeUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('t', token);
  return url.toString();
}
