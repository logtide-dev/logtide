/**
 * Digests Service
 *
 * CRUD for digest_configs (one per organization) and digest_recipients,
 * plus token-based unsubscribe used by the public endpoint.
 */

import crypto from 'crypto';
import { db } from '../../database/connection.js';
import type { DigestFrequency } from '../../database/types.js';
import type { DigestSections } from '@logtide/shared';

export interface DigestConfigInput {
  frequency: DigestFrequency;
  deliveryHour: number;
  deliveryDayOfWeek?: number | null;
  enabled: boolean;
  /** Partial section map; undefined leaves the stored value alone, null resets to defaults. */
  sections?: Partial<DigestSections> | null;
}

export class DigestsService {
  async getConfig(organizationId: string) {
    return db
      .selectFrom('digest_configs')
      .select([
        'id',
        'frequency',
        'delivery_hour',
        'delivery_day_of_week',
        'enabled',
        'last_sent_at',
        'sections',
        'created_at',
        'updated_at',
      ])
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  async upsertConfig(organizationId: string, input: DigestConfigInput) {
    const values = {
      organization_id: organizationId,
      frequency: input.frequency,
      delivery_hour: input.deliveryHour,
      delivery_day_of_week: input.frequency === 'weekly' ? input.deliveryDayOfWeek ?? null : null,
      enabled: input.enabled,
      // The partial is stored as given; defaults live in code, not in the row
      sections: input.sections ?? null,
    };

    return db
      .insertInto('digest_configs')
      .values(values)
      .onConflict((oc) =>
        oc.column('organization_id').doUpdateSet({
          frequency: values.frequency,
          delivery_hour: values.delivery_hour,
          delivery_day_of_week: values.delivery_day_of_week,
          enabled: values.enabled,
          // An omitted sections field keeps whatever is stored; an explicit
          // null resets the organization to the code-side defaults.
          ...(input.sections !== undefined ? { sections: input.sections } : {}),
          updated_at: new Date(),
        })
      )
      .returning([
        'id',
        'frequency',
        'delivery_hour',
        'delivery_day_of_week',
        'enabled',
        'last_sent_at',
        'sections',
        'created_at',
        'updated_at',
      ])
      .executeTakeFirstOrThrow();
  }

  async deleteConfig(organizationId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('digest_configs')
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async listRecipients(organizationId: string) {
    return db
      .selectFrom('digest_recipients')
      .select(['id', 'email', 'user_id', 'subscribed', 'created_at'])
      .where('organization_id', '=', organizationId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async countRecipients(organizationId: string): Promise<number> {
    const row = await db
      .selectFrom('digest_recipients')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * Add a recipient to the organization's digest. The digest config must
   * exist first; recipients hang off it.
   */
  async addRecipient(organizationId: string, email: string, userId?: string | null) {
    const config = await this.getConfig(organizationId);
    if (!config) {
      throw new Error('Digest is not configured for this organization');
    }

    return db
      .insertInto('digest_recipients')
      .values({
        organization_id: organizationId,
        digest_config_id: config.id,
        email,
        user_id: userId ?? null,
        unsubscribe_token: crypto.randomBytes(32).toString('base64url'),
      })
      .returning(['id', 'email', 'user_id', 'subscribed', 'created_at'])
      .executeTakeFirstOrThrow();
  }

  async removeRecipient(organizationId: string, recipientId: string): Promise<boolean> {
    const result = await db
      .deleteFrom('digest_recipients')
      .where('organization_id', '=', organizationId)
      .where('id', '=', recipientId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Re-subscribe a recipient who unsubscribed. Rotates the unsubscribe token
   * so links in previously delivered emails cannot flip the state back.
   */
  async resubscribeRecipient(organizationId: string, recipientId: string) {
    return db
      .updateTable('digest_recipients')
      .set({
        subscribed: true,
        unsubscribe_token: crypto.randomBytes(32).toString('base64url'),
        updated_at: new Date(),
      })
      .where('organization_id', '=', organizationId)
      .where('id', '=', recipientId)
      .returning(['id', 'email', 'user_id', 'subscribed', 'created_at'])
      .executeTakeFirst();
  }

  /**
   * One-click unsubscribe from an email link. The opaque token IS the
   * credential; no authentication involved.
   */
  async unsubscribeByToken(token: string): Promise<{ email: string } | null> {
    // tenant-scope-ok: public unsubscribe path, the unique random token is the credential
    const row = await db
      .updateTable('digest_recipients')
      .set({ subscribed: false, updated_at: new Date() })
      .where('unsubscribe_token', '=', token)
      .returning(['email'])
      .executeTakeFirst();

    return row ?? null;
  }
}

export const digestsService = new DigestsService();
