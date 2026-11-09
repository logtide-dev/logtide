import {
  checkPasswordStrength,
  passwordUserInputs,
  type PasswordCheck,
  type PasswordWeakReason,
} from '@logtide/shared/password';

/** Thrown when a password being set fails the strength policy. */
export class WeakPasswordError extends Error {
  constructor(public readonly check: PasswordCheck) {
    super(check.message ?? 'Password is too weak');
    this.name = 'WeakPasswordError';
  }
}

/** Throws WeakPasswordError unless the password passes the policy for this user. */
export function assertStrongPassword(password: string, user: { email?: string | null; name?: string | null }): void {
  const check = checkPasswordStrength(password, passwordUserInputs(user));
  if (!check.ok) throw new WeakPasswordError(check);
}

export interface WeakPasswordDetail {
  path: [string];
  code: 'weak_password';
  reason: PasswordWeakReason;
  message: string;
}

/** Validation error details for a failed check, in the shape the auth routes already use. */
export function weakPasswordDetails(check: PasswordCheck, field = 'password'): WeakPasswordDetail[] {
  return [
    {
      path: [field],
      code: 'weak_password',
      reason: check.reason ?? 'too_weak',
      message: check.message ?? 'Password is too weak',
    },
  ];
}
