import { sql } from 'kysely';
import { db } from '../database/connection.js';
import { config } from '../config/index.js';
import { getMailer } from '../lib/mailer.js';
import { notificationsService } from '../modules/notifications/service.js';
import { hub } from '@logtide/core';
import { isInternalLoggingEnabled } from '../utils/internal-logger.js';
import { CAPABILITIES, type CapabilityName } from './registry.js';

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

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Sends the in-app notification + email for a quota threshold, at most once per
 * (org, capability, state, UTC month). Dedup reads the notifications already
 * created; no extra table. Never throws.
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
    const existing = await db
      .selectFrom('notifications')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('type', '=', 'system')
      .where(sql<string>`metadata->>'kind'`, '=', 'quota_threshold')
      .where(sql<string>`metadata->>'capability'`, '=', capability)
      .where(sql<string>`metadata->>'state'`, '=', state)
      .where('created_at', '>=', startOfUtcMonth(now))
      .limit(1)
      .executeTakeFirst();
    if (existing) return;

    const recipients = await db
      .selectFrom('organization_members')
      .innerJoin('users', 'users.id', 'organization_members.user_id')
      .select(['users.id as id', 'users.email as email'])
      .where('organization_members.organization_id', '=', organizationId)
      .where('organization_members.role', 'in', ['owner', 'admin'])
      .where('users.disabled', '=', false)
      .execute();
    if (recipients.length === 0) return;

    const org = await db
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
    for (const r of recipients) {
      await notificationsService.createNotification({
        userId: r.id,
        type: 'system',
        title,
        message,
        organizationId,
        metadata,
      });
    }

    const mailer = getMailer();
    if (!mailer) return;
    try {
      await mailer.sendMail({
        from: `"LogTide Notifications" <${config.SMTP_FROM}>`,
        to: recipients.map((r) => r.email).join(', '),
        subject: `[${org?.name ?? 'LogTide'}] ${title}`,
        text: message,
      });
    } catch (err) {
      log('error', `[QuotaNotifier] email failed for org ${organizationId}: ${(err as Error).message}`);
    }
  } catch (err) {
    log('error', `[QuotaNotifier] failed for org ${organizationId}: ${(err as Error).message}`);
  }
}
