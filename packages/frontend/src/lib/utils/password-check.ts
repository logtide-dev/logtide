/**
 * Checks a password against the shared strength policy, loading the policy
 * if the meter has not loaded it yet. Forms call this on submit so a quick
 * submit right after typing is judged, not refused while the module loads.
 */
export async function isStrongPassword(
  password: string,
  user: { email?: string | null; name?: string | null } = {}
): Promise<boolean> {
  if (!password) return false;
  const { checkPasswordStrength, passwordUserInputs } = await import('@logtide/shared/password');
  return checkPasswordStrength(password, passwordUserInputs(user)).ok;
}
