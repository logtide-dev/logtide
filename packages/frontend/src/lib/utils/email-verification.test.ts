import { describe, it, expect } from 'vitest';
import {
  shouldShowVerifyBanner,
  apiErrorMessage,
  EMAIL_NOT_VERIFIED_MESSAGE,
} from './email-verification';

describe('shouldShowVerifyBanner', () => {
  it('shows only when required and the user is explicitly unverified', () => {
    expect(shouldShowVerifyBanner(true, false)).toBe(true);
  });

  it('hides when the gate is off or not advertised', () => {
    expect(shouldShowVerifyBanner(undefined, false)).toBe(false);
    expect(shouldShowVerifyBanner(false, false)).toBe(false);
  });

  it('hides for verified users or when the server did not report the state', () => {
    expect(shouldShowVerifyBanner(true, true)).toBe(false);
    expect(shouldShowVerifyBanner(true, undefined)).toBe(false);
  });
});

describe('apiErrorMessage', () => {
  it('maps email_not_verified to a readable message', () => {
    expect(apiErrorMessage('email_not_verified', 'x')).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('passes other errors through and falls back when empty', () => {
    expect(apiErrorMessage('Project already exists', 'x')).toBe('Project already exists');
    expect(apiErrorMessage(undefined, 'Failed')).toBe('Failed');
  });
});
