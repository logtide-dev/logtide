import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../database/index.js';
import {
  createTestUser,
  createTestOrganization,
  createTestProject,
  createTestApiKey,
} from '../helpers/factories.js';

describe('w13 migrations', () => {
  it('creates password_reset_tokens with unique token_hash', async () => {
    const user = await createTestUser();
    const expires = new Date(Date.now() + 3600_000);
    await db
      .insertInto('password_reset_tokens')
      .values({ user_id: user.id, token_hash: 'dup-hash', expires_at: expires })
      .execute();

    await expect(
      db
        .insertInto('password_reset_tokens')
        .values({ user_id: user.id, token_hash: 'dup-hash', expires_at: expires })
        .execute(),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('cascades token rows when the user is deleted', async () => {
    const user = await createTestUser();
    await db
      .insertInto('password_reset_tokens')
      .values({ user_id: user.id, token_hash: 'cascade-hash', expires_at: new Date(Date.now() + 3600_000) })
      .execute();

    await db.deleteFrom('users').where('id', '=', user.id).execute();

    const rows = await db
      .selectFrom('password_reset_tokens')
      .select('id')
      .where('token_hash', '=', 'cascade-hash')
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('adds nullable key_prefix to api_keys and leaves existing rows null', async () => {
    const key = await createTestApiKey();
    const row = await db
      .selectFrom('api_keys')
      .select('key_prefix')
      .where('id', '=', key.id)
      .executeTakeFirstOrThrow();
    expect(row.key_prefix).toBeNull();
  });

  it('user_onboarding resume columns are nullable and FK set null', async () => {
    const user = await createTestUser();
    const org = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: org.id, userId: user.id });

    await db
      .insertInto('user_onboarding')
      .values({ user_id: user.id, checklist_items: {} as any })
      .execute();

    const fresh = await db
      .selectFrom('user_onboarding')
      .select(['onboarding_step', 'organization_id', 'project_id'])
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(fresh).toEqual({ onboarding_step: null, organization_id: null, project_id: null });

    await db
      .updateTable('user_onboarding')
      .set({ onboarding_step: 'connect', organization_id: org.id, project_id: project.id })
      .where('user_id', '=', user.id)
      .execute();

    await sql`DELETE FROM projects WHERE id = ${project.id}`.execute(db);

    const after = await db
      .selectFrom('user_onboarding')
      .select(['onboarding_step', 'organization_id', 'project_id'])
      .where('user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(after.project_id).toBeNull();
    expect(after.organization_id).toBe(org.id);
    expect(after.onboarding_step).toBe('connect');
  });
});
