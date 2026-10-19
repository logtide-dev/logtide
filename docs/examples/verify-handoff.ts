/**
 * Reference verifier for the LogTide upgrade handoff token.
 *
 * Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, base64url payload)).
 * The HMAC is computed over the base64url-encoded payload string, not the decoded JSON.
 * Returns the payload, or null for any malformed, tampered or expired token.
 *
 * Only depends on Node's built-in crypto. See docs/cloud-seams.md.
 */
import crypto from 'node:crypto';

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

function sign(secret: string, encodedPayload: string): Buffer {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest();
}

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
