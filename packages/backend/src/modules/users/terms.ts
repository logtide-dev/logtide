import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { config } from '../../config/index.js';

export interface ActiveTerms {
  termsUrl: string;
  privacyUrl: string;
  termsVersion: string;
}

type TermsConfig = { LOGTIDE_TERMS_URL?: string; LOGTIDE_PRIVACY_URL?: string; LOGTIDE_TERMS_VERSION?: string };

/**
 * The configured terms when the seam is active (all three env vars set), null
 * otherwise. Reads the config fields at call time (not a helper exported by the
 * config module) so suites that mock the config object keep the feature off.
 */
export function getActiveTerms(): ActiveTerms | null {
  const c = config as TermsConfig;
  if (!c.LOGTIDE_TERMS_URL || !c.LOGTIDE_PRIVACY_URL || !c.LOGTIDE_TERMS_VERSION) return null;
  return { termsUrl: c.LOGTIDE_TERMS_URL, privacyUrl: c.LOGTIDE_PRIVACY_URL, termsVersion: c.LOGTIDE_TERMS_VERSION };
}

export class TermsAcceptanceService {
  /**
   * True when the seam is active and the user has not accepted the current
   * version (NULL included). Zero queries when inactive. Read fresh from the
   * DB: the session cache would lag behind an accept.
   */
  async isPending(userId: string): Promise<boolean> {
    const terms = getActiveTerms();
    if (!terms) return false;
    const row = await db
      .selectFrom('users')
      .select('terms_version')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.terms_version !== terms.termsVersion;
  }

  /** Record acceptance of `version` for the user. */
  async accept(userId: string, version: string): Promise<void> {
    await db
      .updateTable('users')
      .set({ terms_accepted_at: sql`NOW()`, terms_version: version })
      .where('id', '=', userId)
      .execute();
  }
}

export const termsAcceptanceService = new TermsAcceptanceService();

/** Error code for an auth-free mode request while the terms seam is active. */
export const TERMS_AUTH_FREE_ERROR = 'terms_incompatible_with_auth_free_mode';
export const TERMS_AUTH_FREE_MESSAGE =
  'Terms acceptance (LOGTIDE_TERMS_URL, LOGTIDE_PRIVACY_URL, LOGTIDE_TERMS_VERSION) cannot be combined with ' +
  'auth-free mode: the default user has no session and could never accept the terms. Switch the auth mode ' +
  'back to standard or unset the LOGTIDE_TERMS_* variables.';

/**
 * Refuses to start when the terms seam is active and the stored auth mode is
 * 'none'. No query when the seam is inactive.
 */
export async function assertTermsCompatibleWithAuthMode(): Promise<void> {
  if (!getActiveTerms()) return;
  const { settingsService } = await import('../settings/service.js');
  if ((await settingsService.getAuthMode()) === 'none') {
    throw new Error(TERMS_AUTH_FREE_MESSAGE);
  }
}
