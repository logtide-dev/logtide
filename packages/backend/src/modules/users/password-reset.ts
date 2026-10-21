import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { sql } from 'kysely';
import { hub } from '@logtide/core';
import { db } from '../../database/connection.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { getMailer } from '../../lib/mailer.js';
import { generatePasswordResetEmail } from '../../lib/email-templates.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import { providerRegistry } from '../auth/providers/registry.js';
import { auditLogService } from '../audit-log/index.js';
import { RESEND_COOLDOWN_MS } from './email-verification.js';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_MAX_PER_HOUR = 3;

const SALT_ROUNDS = 10;

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type ConfirmResult = { ok: true; userId: string } | { ok: false };

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (isInternalLoggingEnabled()) hub.captureLog(level, msg, meta);
}

export class PasswordResetService {
  /** Password reset needs a way to deliver the link and a local password to reset. */
  async isAvailable(): Promise<boolean> {
    if (!isSmtpConfigured()) return false;
    return (await providerRegistry.getLocalProvider()) !== null;
  }

  /**
   * Issue a reset link for the address when it belongs to an eligible account
   * (local password, not disabled) and the per-account limits allow it. Every
   * other case returns silently so callers can always answer the same way.
   * Never throws on SMTP failure.
   */
  async requestForEmail(email: string): Promise<void> {
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'disabled', 'password_hash'])
      .where('email', '=', email.toLowerCase().trim())
      .executeTakeFirst();
    if (!user || user.disabled || !user.password_hash) return;

    // DB based limits: the cooldown stops double clicks, the hourly cap stops
    // mailbox flooding. Both use the database clock so they agree with created_at.
    const cooldown = await db
      .selectFrom('password_reset_tokens')
      .select('id')
      .where('user_id', '=', user.id)
      .where('created_at', '>', sql<Date>`NOW() - (${RESEND_COOLDOWN_MS} * INTERVAL '1 millisecond')`)
      .executeTakeFirst();
    if (cooldown) return;

    const hourly = await db
      .selectFrom('password_reset_tokens')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('user_id', '=', user.id)
      .where('created_at', '>', sql<Date>`NOW() - INTERVAL '1 hour'`)
      .executeTakeFirst();
    if (Number(hourly?.count ?? 0) >= PASSWORD_RESET_MAX_PER_HOUR) return;

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);

    // A newer link kills the older one. Old rows are marked used rather than
    // deleted so the hourly cap above still counts them.
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('password_reset_tokens')
        .set({ used_at: sql`NOW()` })
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .execute();
      await trx
        .insertInto('password_reset_tokens')
        .values({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: sql<Date>`NOW() + (${PASSWORD_RESET_TTL_MS} * INTERVAL '1 millisecond')`,
        })
        .execute();
    });

    await auditLogService.record({
      action: 'user.password_reset_requested',
      target: { type: 'user', id: user.id },
      organizationId: null,
      actor: { type: 'user', id: user.id, label: null },
    });

    const mailer = getMailer();
    if (!mailer) {
      log('warn', '[PasswordReset] SMTP not configured, reset email not sent', { userId: user.id });
      return;
    }
    try {
      const { html, text } = generatePasswordResetEmail({ name: user.name, token });
      await mailer.sendMail({
        from: `"LogTide" <${config.SMTP_FROM}>`,
        to: user.email,
        subject: 'Reset your LogTide password',
        text,
        html,
      });
    } catch (err) {
      log('error', '[PasswordReset] failed to send reset email', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Consume a token and set the new password in one transaction. Single use is
   * enforced by the conditional UPDATE. When `expectedUserId` is given (the
   * caller holds a session) a token belonging to someone else is rejected
   * WITHOUT being consumed. Revoking sessions is the caller's job, after commit.
   */
  async confirm(token: string, newPassword: string, expectedUserId?: string): Promise<ConfirmResult> {
    const tokenHash = hashResetToken(token);
    // Hash before touching the token so the response time never depends on
    // whether the token was valid.
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    return db.transaction().execute(async (trx) => {
      let query = trx
        .updateTable('password_reset_tokens')
        .set({ used_at: sql`NOW()` })
        .where('token_hash', '=', tokenHash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', sql<Date>`NOW()`)
        .where('user_id', 'in', (eb) =>
          eb
            .selectFrom('users')
            .select('users.id')
            .where('users.disabled', '=', false)
            .where('users.password_hash', 'is not', null)
        );
      if (expectedUserId) {
        query = query.where('user_id', '=', expectedUserId);
      }
      const consumed = await query.returning('user_id').executeTakeFirst();
      if (!consumed) return { ok: false as const };

      await trx
        .updateTable('users')
        .set({
          password_hash: passwordHash,
          // Receiving the link proves control of the mailbox.
          email_verified_at: sql`COALESCE(email_verified_at, NOW())`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', consumed.user_id)
        .execute();

      await trx
        .updateTable('password_reset_tokens')
        .set({ used_at: sql`NOW()` })
        .where('user_id', '=', consumed.user_id)
        .where('used_at', 'is', null)
        .execute();

      return { ok: true as const, userId: consumed.user_id };
    });
  }
}

export const passwordResetService = new PasswordResetService();

/** Spread-ready fragment for the public auth config. */
export async function getPasswordResetConfig(): Promise<{ passwordResetEnabled?: true }> {
  return (await passwordResetService.isAvailable()) ? { passwordResetEnabled: true } : {};
}
