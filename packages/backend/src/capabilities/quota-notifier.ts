import { sql } from 'kysely';
import { db } from '../database/connection.js';
import { config } from '../config/index.js';
import { getMailer } from '../lib/mailer.js';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../utils/internal-logger.js';
import { CAPABILITIES, type CapabilityName } from './registry.js';
import { startOfUtcMonth } from './month.js';

export type QuotaNotifyState = 'grace' | 'blocked';

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (isInternalLoggingEnabled()) hub.captureLog(level, msg, meta);
}

export function formatQuotaValue(cap: CapabilityName, value: number): string {
  const def = CAPABILITIES[cap] as { signal?: string };
  if (def.signal && (def.signal.endsWith('.bytes') || def.signal === 'storage.snapshot')) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = value;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${units[i]}`;
  }
  return value.toLocaleString('en-US');
}

/**
 * Sends the in-app notification + email for a quota threshold, at most once per
 * (org, capability, state, limit, UTC month). The limit is part of the key so an
 * org whose limit is raised mid-month is warned again at the new ceiling. Dedup
 * reads the notifications already created (no extra table) and is atomic across
 * backend replicas: the check and the inserts run in one transaction holding a
 * transaction-scoped advisory lock on that key; a replica that cannot take the
 * lock skips (another one is sending). Never throws.
 */
export async function notifyQuotaThreshold(params: {
  organizationId: string;
  capability: CapabilityName;
  state: QuotaNotifyState;
  usage: number;
  limit: number;
  gracePercent: number;
  now: Date;
}): Promise<void> {
  const { organizationId, capability, state, usage, limit, gracePercent, now } = params;
  try {
    const monthStart = startOfUtcMonth(now);
    const dedupKey = `quota_threshold:${organizationId}:${capability}:${state}:${limit}:${monthStart.toISOString()}`;

    const sent = await db.transaction().execute(async (trx) => {
      const lock = await sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(hashtext(${dedupKey})) AS acquired`.execute(trx);
      if (!lock.rows[0]?.acquired) return null;

      const existing = await trx
        .selectFrom('notifications')
        .select('id')
        .where('organization_id', '=', organizationId)
        .where('type', '=', 'system')
        .where(sql<string>`metadata->>'kind'`, '=', 'quota_threshold')
        .where(sql<string>`metadata->>'capability'`, '=', capability)
        .where(sql<string>`metadata->>'state'`, '=', state)
        .where(sql<string>`metadata->>'limit'`, '=', String(limit))
        .where('created_at', '>=', monthStart)
        .limit(1)
        .executeTakeFirst();
      if (existing) return null;

      const recipients = await trx
        .selectFrom('organization_members')
        .innerJoin('users', 'users.id', 'organization_members.user_id')
        .select(['users.id as id', 'users.email as email'])
        .where('organization_members.organization_id', '=', organizationId)
        .where('organization_members.role', 'in', ['owner', 'admin'])
        .where('users.disabled', '=', false)
        .execute();
      if (recipients.length === 0) return null;

      const org = await trx
        .selectFrom('organizations')
        .select('name')
        .where('id', '=', organizationId)
        .executeTakeFirst();

      const used = formatQuotaValue(capability, usage);
      const cap = formatQuotaValue(capability, limit);
      const title =
        state === 'blocked'
          ? `Quota reached: ${capability}`
          : `Quota exceeded, grace period active: ${capability}`;
      const message =
        state === 'blocked'
          ? `${capability} is now blocked: ${used} used of ${cap}${
              gracePercent > 0 ? ` (including a ${gracePercent.toLocaleString('en-US')}% grace allowance)` : ''
            }. New data for this quota is rejected until the quota resets or the limit is raised.`
          : `${capability} passed its limit: ${used} used of ${cap}. You are within a ${gracePercent.toLocaleString(
              'en-US'
            )}% grace allowance; once it is used up, new data for this quota will be rejected.`;

      const metadata = { kind: 'quota_threshold', capability, state, usage, limit };
      await trx
        .insertInto('notifications')
        .values(
          recipients.map((r) => ({
            user_id: r.id,
            type: 'system' as const,
            title,
            message,
            organization_id: organizationId,
            metadata,
          }))
        )
        .execute();

      return { recipients, title, message, orgName: org?.name };
    });
    if (!sent) return;

    // Email only after the notifications committed, outside the transaction.
    const mailer = getMailer();
    if (!mailer) return;
    try {
      await mailer.sendMail({
        from: `"LogTide Notifications" <${config.SMTP_FROM}>`,
        to: sent.recipients.map((r) => r.email).join(', '),
        subject: `[${sent.orgName ?? 'LogTide'}] ${sent.title}`,
        text: sent.message,
      });
    } catch (err) {
      log('error', `[QuotaNotifier] email failed for org ${organizationId}: ${(err as Error).message}`);
    }
  } catch (err) {
    log('error', `[QuotaNotifier] failed for org ${organizationId}: ${(err as Error).message}`);
  }
}
