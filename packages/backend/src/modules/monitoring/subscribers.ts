import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import { context } from '@logtide/shared/context';
import { db as defaultDb } from '../../database/index.js';
import type { Database } from '../../database/types.js';
import { config } from '../../config/index.js';
import { getMailer } from '../../lib/mailer.js';
import { assertWithinLimit, withLimitLock, CapabilityError } from '../../capabilities/index.js';
import { StatusPageService } from './status-page.js';
import { generateConfirmationEmail, statusPageUrl } from './status-emails.js';

/**
 * Double opt-in email subscriptions of the public status page.
 *
 * - Confirm token: 32 random bytes, only its SHA-256 is stored, valid 48 h,
 *   single use.
 * - Unsubscribe token: `<subscriberId>.<base64url HMAC>` derived from
 *   API_KEY_SECRET, so it needs no storage and can be verified in constant time.
 * - subscribe() never reveals whether an address is already known: callers
 *   always answer with the same body, and never an error that depends on the
 *   address or on the org's plan limit.
 * - Only confirmed subscribers count against status_page.subscribers.max; the
 *   limit is enforced when the address is confirmed. Unconfirmed rows are
 *   bounded per page and the mails per address per day, so strangers can
 *   neither fill the quota nor use the page as a mail relay.
 */

export const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const SUBSCRIBERS_CAPABILITY = 'status_page.subscribers.max';
/** Confirmation mails one address can receive per window from one status page. */
export const MAX_CONFIRMATIONS_PER_ADDRESS = 3;
export const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Unconfirmed rows one status page keeps; beyond it new addresses are silently ignored. */
export const MAX_PENDING_PER_PAGE = 200;
const ADMIN_PAGE_SIZE = 50;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function unsubscribeMac(subscriberId: string): Buffer {
  return crypto
    .createHmac('sha256', config.API_KEY_SECRET)
    .update(`status-unsubscribe:${subscriberId}`)
    .digest();
}

export function makeUnsubscribeToken(subscriberId: string): string {
  return `${subscriberId}.${unsubscribeMac(subscriberId).toString('base64url')}`;
}

/** Returns the subscriber id when the token is authentic, otherwise null. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = unsubscribeMac(id);
  if (given.length !== expected.length) return null;
  return crypto.timingSafeEqual(given, expected) ? id : null;
}

export interface SubscribeInput {
  organizationId: string;
  projectId: string;
  orgSlug: string;
  projectSlug: string;
  projectName: string;
  email: string;
}

export class StatusSubscribersService {
  constructor(private db: Kysely<Database> = defaultDb) {}

  /** Confirmed subscribers, org-wide. Pending rows never count against the quota. */
  async countConfirmedForOrg(organizationId: string): Promise<number> {
    const row = await this.db
      .selectFrom('status_page_subscribers')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('organization_id', '=', organizationId)
      .where('confirmed_at', 'is not', null)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** True when the org is at its subscriber limit (counting confirmed rows only). */
  private async atSubscriberLimit(organizationId: string): Promise<boolean> {
    const current = await this.countConfirmedForOrg(organizationId);
    try {
      await context.runAsSystem('status-subscribers:limit-check', async () => {
        await context.with({ organizationId }, async () => {
          await assertWithinLimit(SUBSCRIBERS_CAPABILITY, current);
        });
      });
      return false;
    } catch (err) {
      if (err instanceof CapabilityError) return true;
      throw err;
    }
  }

  /**
   * Creates (or re-arms) a pending subscription and mails the confirmation
   * link. Known addresses, the resend cooldown, the per-address mail cap, the
   * per-page pending cap and a full subscriber quota are all silent no-ops, so
   * the caller's answer never depends on them.
   */
  async subscribe(input: SubscribeInput): Promise<void> {
    const emailNormalized = normalizeEmail(input.email);
    const display = input.email.trim();

    const token = await withLimitLock(input.organizationId, SUBSCRIBERS_CAPABILITY, async () => {
      const now = new Date();

      // Expired pending rows of this project are dead weight: drop them so
      // they neither count against the quota nor block a fresh attempt.
      await this.db
        .deleteFrom('status_page_subscribers')
        .where('project_id', '=', input.projectId)
        .where('organization_id', '=', input.organizationId)
        .where('confirmed_at', 'is', null)
        .where('confirm_expires_at', '<', now)
        .execute();

      const existing = await this.db
        .selectFrom('status_page_subscribers')
        .select([
          'id',
          'confirmed_at',
          'last_confirmation_sent_at',
          'confirmation_send_count',
          'confirmation_window_started_at',
        ])
        .where('project_id', '=', input.projectId)
        .where('organization_id', '=', input.organizationId)
        .where('email_normalized', '=', emailNormalized)
        .executeTakeFirst();

      if (existing?.confirmed_at) return null;

      const fresh = crypto.randomBytes(32).toString('base64url');
      if (existing) {
        const last = existing.last_confirmation_sent_at
          ? new Date(existing.last_confirmation_sent_at).getTime()
          : 0;
        if (now.getTime() - last < RESEND_COOLDOWN_MS) return null;

        const windowStart = existing.confirmation_window_started_at
          ? new Date(existing.confirmation_window_started_at)
          : null;
        const inWindow = !!windowStart && now.getTime() - windowStart.getTime() < CONFIRMATION_WINDOW_MS;
        if (inWindow && existing.confirmation_send_count >= MAX_CONFIRMATIONS_PER_ADDRESS) return null;

        await this.db
          .updateTable('status_page_subscribers')
          .set({
            confirm_token_hash: hashToken(fresh),
            confirm_expires_at: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
            last_confirmation_sent_at: now,
            confirmation_send_count: inWindow ? existing.confirmation_send_count + 1 : 1,
            confirmation_window_started_at: inWindow ? windowStart : now,
          })
          .where('id', '=', existing.id)
          .where('organization_id', '=', input.organizationId)
          .execute();
        return fresh;
      }

      const pending = await this.db
        .selectFrom('status_page_subscribers')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('project_id', '=', input.projectId)
        .where('organization_id', '=', input.organizationId)
        .where('confirmed_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(pending.c) >= MAX_PENDING_PER_PAGE) return null;

      // Do not mail people who could not be confirmed anyway.
      if (await this.atSubscriberLimit(input.organizationId)) return null;

      await this.db
        .insertInto('status_page_subscribers')
        .values({
          organization_id: input.organizationId,
          project_id: input.projectId,
          email: display,
          email_normalized: emailNormalized,
          confirm_token_hash: hashToken(fresh),
          confirm_expires_at: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
          last_confirmation_sent_at: now,
          confirmation_send_count: 1,
          confirmation_window_started_at: now,
        })
        .execute();
      return fresh;
    });

    if (!token) return;
    await this.sendConfirmation(input, display, token);
  }

  private async sendConfirmation(input: SubscribeInput, to: string, token: string): Promise<void> {
    const mailer = getMailer();
    if (!mailer) return;
    try {
      const cfg = await new StatusPageService(this.db).getConfig(input.projectId, input.organizationId);
      const pageTitle = cfg.title ?? input.projectName;
      const confirmUrl = `${statusPageUrl(input.orgSlug, input.projectSlug)}/confirm?token=${encodeURIComponent(token)}`;
      const mail = generateConfirmationEmail({ pageTitle, accentColor: cfg.accentColor, confirmUrl });
      await mailer.sendMail({
        from: config.SMTP_FROM || 'noreply@logtide.local',
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    } catch (err) {
      // The response must not depend on mail delivery (it would leak state),
      // so a failed send is only logged. The 60 s cooldown still applies.
      console.error('[StatusSubscribers] confirmation email failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Consumes a confirmation token. False when unknown, expired, already used,
   * or when the org's subscriber limit is reached (the quota is enforced here,
   * on confirmed addresses only).
   */
  async confirm(organizationId: string, projectId: string, token: string): Promise<boolean> {
    if (typeof token !== 'string' || token.length < 16 || token.length > 200) return false;
    return withLimitLock(organizationId, SUBSCRIBERS_CAPABILITY, async () => {
      const now = new Date();
      const valid = await this.db
        .selectFrom('status_page_subscribers')
        .select('id')
        .where('organization_id', '=', organizationId)
        .where('project_id', '=', projectId)
        .where('confirm_token_hash', '=', hashToken(token))
        .where('confirmed_at', 'is', null)
        .where('confirm_expires_at', '>', now)
        .executeTakeFirst();
      if (!valid) return false;
      if (await this.atSubscriberLimit(organizationId)) return false;

      const row = await this.db
        .updateTable('status_page_subscribers')
        .set({ confirmed_at: now, confirm_token_hash: null, confirm_expires_at: null })
        .where('id', '=', valid.id)
        .where('organization_id', '=', organizationId)
        .where('confirmed_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return !!row;
    });
  }

  /** Removes a subscriber by a signed token. False when the token is not authentic. */
  async unsubscribe(organizationId: string, projectId: string, token: string): Promise<boolean> {
    const id = verifyUnsubscribeToken(token);
    if (!id) return false;
    await this.db
      .deleteFrom('status_page_subscribers')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .where('project_id', '=', projectId)
      .execute();
    return true;
  }

  async listConfirmed(
    organizationId: string,
    projectId: string,
    page = 1
  ): Promise<{ subscribers: { id: string; email: string; confirmedAt: string; createdAt: string }[]; total: number }> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const [rows, totalRow] = await Promise.all([
      this.db
        .selectFrom('status_page_subscribers')
        .select(['id', 'email', 'confirmed_at', 'created_at'])
        .where('organization_id', '=', organizationId)
        .where('project_id', '=', projectId)
        .where('confirmed_at', 'is not', null)
        .orderBy('confirmed_at', 'desc')
        .orderBy('id', 'asc')
        .limit(ADMIN_PAGE_SIZE)
        .offset((safePage - 1) * ADMIN_PAGE_SIZE)
        .execute(),
      this.db
        .selectFrom('status_page_subscribers')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('organization_id', '=', organizationId)
        .where('project_id', '=', projectId)
        .where('confirmed_at', 'is not', null)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      subscribers: rows.map((r) => ({
        id: r.id,
        email: r.email,
        confirmedAt: new Date(r.confirmed_at as Date).toISOString(),
        createdAt: new Date(r.created_at as Date).toISOString(),
      })),
      total: Number(totalRow.c),
    };
  }

  async remove(id: string, organizationId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('status_page_subscribers')
      .where('id', '=', id)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  }
}

export const statusSubscribersService = new StatusSubscribersService();
