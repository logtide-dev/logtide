import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { usersService } from '../../../modules/users/service.js';
import { passwordResetService, hashResetToken, PASSWORD_RESET_TTL_MS } from '../../../modules/users/password-reset.js';
import { CacheManager } from '../../../utils/cache.js';
import { createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const uniqueEmail = (tag: string) => `${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;

async function issueToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db
    .insertInto('password_reset_tokens')
    .values({
      user_id: userId,
      token_hash: hashResetToken(token),
      expires_at: sql<Date>`NOW() + (${PASSWORD_RESET_TTL_MS} * INTERVAL '1 millisecond')`,
    })
    .execute();
  return token;
}

describe('AU1: reset tokens die when the account email or password changes', () => {
  it('a token mailed to the old address cannot be used after an email change', async () => {
    const user = await createTestUser({ email: uniqueEmail('old') });
    await db.updateTable('users').set({ email_verified_at: null }).where('id', '=', user.id).execute();
    const token = await issueToken(user.id);

    await usersService.updateUser(user.id, { email: uniqueEmail('new') });

    const res = await passwordResetService.confirm(token, 'brand-new-pass-1');
    expect(res.ok).toBe(false);
    const row = await db.selectFrom('users').select('email_verified_at').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(row.email_verified_at).toBeNull();
  });

  it('a name-only update leaves the outstanding token usable', async () => {
    const user = await createTestUser({ email: uniqueEmail('keep') });
    const token = await issueToken(user.id);
    await usersService.updateUser(user.id, { name: 'Renamed' });
    expect((await passwordResetService.confirm(token, 'brand-new-pass-1')).ok).toBe(true);
  });

  it('a password change through the profile also invalidates outstanding tokens', async () => {
    const user = await createTestUser({ email: uniqueEmail('pw'), password: 'old-password-1' } as any);
    const token = await issueToken(user.id);
    await usersService.updateUser(user.id, { currentPassword: 'old-password-1', newPassword: 'another-pass-22' } as any);
    expect((await passwordResetService.confirm(token, 'brand-new-pass-1')).ok).toBe(false);
  });
});

describe('AU6: revokeAllSessions removes the rows before the cache entries', () => {
  it('rows are already gone when the cache is invalidated', async () => {
    const user = await createTestUser({ email: uniqueEmail('rev') });
    const s1 = await createTestSession(user.id);
    await createTestSession(user.id);

    const seen: number[] = [];
    const spy = vi.spyOn(CacheManager, 'invalidateSession').mockImplementation(async () => {
      const rows = await db.selectFrom('sessions').select('id').where('user_id', '=', user.id).execute();
      seen.push(rows.length);
    });

    expect(await usersService.revokeAllSessions(user.id)).toBe(2);
    expect(spy).toHaveBeenCalledWith(s1.token);
    expect(seen).toEqual([0, 0]);
  });
});
