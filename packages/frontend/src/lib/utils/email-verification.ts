/** Error code the backend returns when the email verification gate blocks an action. */
export const EMAIL_NOT_VERIFIED = 'email_not_verified';

export const EMAIL_NOT_VERIFIED_MESSAGE =
  'Verify your email address first. Check your inbox for the verification link.';

/**
 * The "Verify your email" banner is shown only when the backend advertises the
 * gate (auth config `emailVerificationRequired`) AND reports the current user
 * as unverified. A missing `emailVerified` means the server did not say, so
 * nothing is shown.
 */
export function shouldShowVerifyBanner(
  emailVerificationRequired: boolean | undefined,
  emailVerified: boolean | undefined
): boolean {
  return emailVerificationRequired === true && emailVerified === false;
}

/** Error code the backend returns while the current Terms version is not accepted. */
export const TERMS_NOT_ACCEPTED = 'terms_not_accepted';

export const TERMS_NOT_ACCEPTED_MESSAGE =
  'Accept the Terms of Service and the Privacy Policy first.';

/** Turns a backend error code into the message shown to the user. */
export function apiErrorMessage(error: string | undefined, fallback: string): string {
  if (error === EMAIL_NOT_VERIFIED) return EMAIL_NOT_VERIFIED_MESSAGE;
  if (error === TERMS_NOT_ACCEPTED) return TERMS_NOT_ACCEPTED_MESSAGE;
  return error || fallback;
}
