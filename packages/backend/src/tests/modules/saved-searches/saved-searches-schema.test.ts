import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { db } from '../../../database/index.js';
import { createTestContext, createTestUser } from '../../helpers/index.js';

// Migration 063: the saved_searches table.

const state = { q: 'level:error timeout', projectIds: [] as string[], range: '24h' as const };

describe('saved_searches table', () => {
  it('stores a row with defaults', async () => {
    const ctx = await createTestContext();
    const row = await db
      .insertInto('saved_searches')
      .values({
        organization_id: ctx.organization.id,
        created_by: ctx.user.id,
        name: 'Checkout errors',
        state: JSON.stringify(state),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.visibility).toBe('private');
    expect(row.state).toEqual(state);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  it('rejects an unknown visibility', async () => {
    const ctx = await createTestContext();
    await expect(
      db
        .insertInto('saved_searches')
        .values({
          organization_id: ctx.organization.id,
          created_by: ctx.user.id,
          name: 'Public one',
          visibility: 'public' as any,
          state: JSON.stringify(state),
        })
        .execute(),
    ).rejects.toThrow(/saved_searches_visibility_check/);
  });

  it('cascades on organization delete', async () => {
    const ctx = await createTestContext();
    const row = await db
      .insertInto('saved_searches')
      .values({
        organization_id: ctx.organization.id,
        created_by: ctx.user.id,
        name: 'Goes away',
        visibility: 'organization',
        state: JSON.stringify(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.deleteFrom('projects').where('organization_id', '=', ctx.organization.id).execute();
    await db.deleteFrom('organizations').where('id', '=', ctx.organization.id).execute();

    const left = await db
      .selectFrom('saved_searches')
      .select('id')
      .where('id', '=', row.id)
      .where('organization_id', '=', ctx.organization.id)
      .executeTakeFirst();
    expect(left).toBeUndefined();
  });

  it('sets created_by to null when the user is deleted', async () => {
    const ctx = await createTestContext();
    const member = await createTestUser({ email: `member-${crypto.randomUUID()}@example.com` });
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: ctx.organization.id, role: 'member' })
      .execute();
    const row = await db
      .insertInto('saved_searches')
      .values({
        organization_id: ctx.organization.id,
        created_by: member.id,
        name: 'Orphaned',
        visibility: 'organization',
        state: JSON.stringify(state),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.deleteFrom('users').where('id', '=', member.id).execute();

    const after = await db
      .selectFrom('saved_searches')
      .select(['id', 'created_by', 'name'])
      .where('id', '=', row.id)
      .where('organization_id', '=', ctx.organization.id)
      .executeTakeFirstOrThrow();
    expect(after.created_by).toBeNull();
    expect(after.name).toBe('Orphaned');
  });
});
