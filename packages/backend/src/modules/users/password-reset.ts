/**
 * PLACEHOLDER owned by W13 (password reset). It exists only so the public auth
 * config can import the real signature before W13 merges. On merge, take W13's
 * version of this file in full.
 */
export async function getPasswordResetConfig(): Promise<{ passwordResetEnabled?: true }> {
  return {};
}
