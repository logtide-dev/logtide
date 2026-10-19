import { config } from '../../config/index.js';

/**
 * True only when REQUIRE_EMAIL_VERIFICATION=true. Reads the config field
 * directly (instead of a helper exported by the config module) so modules
 * that mock the config object keep the gate off by default.
 */
export function isEmailVerificationRequired(): boolean {
  return config.REQUIRE_EMAIL_VERIFICATION === true;
}
