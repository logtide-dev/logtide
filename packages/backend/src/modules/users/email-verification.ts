import crypto from 'crypto';
import { sql } from 'kysely';
import { hub } from '@logtide/core';
import { db } from '../../database/connection.js';
import { config } from '../../config/index.js';
import { isEmailVerificationRequired } from './email-verification-flag.js';
import { getMailer } from '../../lib/mailer.js';
import { generateEmailVerificationEmail } from '../../lib/email-templates.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** A new verification email is not sent if one was issued this recently. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

export function hashVerificationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' };

function log(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (isInternalLoggingEnabled()) hub.captureLog(level, msg, meta);
}

export class EmailVerificationService {
  /** True when the gate is on and the user has not confirmed their email. */
  async isBlocked(userId: string): Promise<boolean> {
    if (!isEmailVerificationRequired()) return false;
    return !(await this.isVerified(userId));
  }

  async isVerified(userId: string): Promise<boolean> {
    const row = await db
      .selectFrom('users')
      .select('email_verified_at')
      .where('id', '=', userId)
      .executeTakeFirst();
    return !!row?.email_verified_at;
  }

  /**
   * Issue a fresh single-use token (previous unused tokens for the user are
   * discarded) and email the link. Returns the raw token. Never throws on
   * SMTP failure: the user can always ask for a resend.
   */
  async issueAndSend(user: { id: string; email: string; name: string }): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashVerificationToken(token);

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('email_verification_tokens')
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .execute();
      await trx
        .insertInto('email_verification_tokens')
        .values({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        })
        .execute();
    });

    const mailer = getMailer();
    if (!mailer) {
      log('warn', '[EmailVerification] SMTP not configured, verification email not sent', { userId: user.id });
      return token;
    }
    try {
      const { html, text } = generateEmailVerificationEmail({ name: user.name, token });
      await mailer.sendMail({
        from: `"LogTide" <${config.SMTP_FROM}>`,
        to: user.email,
        subject: 'Verify your email for LogTide',
        text,
        html,
      });
    } catch (err) {
      log('error', '[EmailVerification] failed to send verification email', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return token;
  }

  /**
   * Consume a token. Single use is enforced atomically by the conditional
   * UPDATE (used_at IS NULL AND not expired). When `expectedUserId` is given
   * (the caller is signed in) a token belonging to someone else is rejected
   * WITHOUT being consumed.
   */
  async verify(token: string, expectedUserId?: string): Promise<VerifyResult> {
    const tokenHash = hashVerificationToken(token);

    return db.transaction().execute(async (trx) => {
      let query = trx
        .updateTable('email_verification_tokens')
        .set({ used_at: sql`NOW()` })
        .where('token_hash', '=', tokenHash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', sql<Date>`NOW()`);
      if (expectedUserId) {
        query = query.where('user_id', '=', expectedUserId);
      }
      const consumed = await query.returning('user_id').executeTakeFirst();
      if (!consumed) return { ok: false as const, reason: 'invalid' as const };

      await trx
        .updateTable('users')
        .set({ email_verified_at: sql`NOW()` })
        .where('id', '=', consumed.user_id)
        .where('email_verified_at', 'is', null)
        .execute();

      return { ok: true as const, userId: consumed.user_id };
    });
  }

  /**
   * Resend for an unverified user, subject to a short cooldown. Silently does
   * nothing for unknown, disabled or already verified users so callers can
   * always answer the same way.
   */
  async resendForUser(userId: string): Promise<void> {
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'disabled', 'email_verified_at'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.disabled || user.email_verified_at) return;

    const recent = await db
      .selectFrom('email_verification_tokens')
      .select('id')
      .where('user_id', '=', user.id)
      .where('created_at', '>', new Date(Date.now() - RESEND_COOLDOWN_MS))
      .executeTakeFirst();
    if (recent) return;

    await this.issueAndSend(user);
  }

  async resendForEmail(email: string): Promise<void> {
    const user = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email.toLowerCase().trim())
      .executeTakeFirst();
    if (user) await this.resendForUser(user.id);
  }

}

export const emailVerificationService = new EmailVerificationService();
