/**
 * Password strength policy shared by the backend (enforcement) and the
 * frontend (live meter). Kept out of the package index on purpose: the
 * zxcvbn dictionaries are large, so the frontend loads this module lazily.
 */
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

export const PASSWORD_MIN_LENGTH = 12;

/** zxcvbn score a password needs to be accepted (0 to 4). */
const MIN_SCORE = 3;

/** Only this many characters are scored: zxcvbn cost grows fast with length (about 200 ms at 64 chars in the worst case) and a longer password already clears the length rule. */
const SCORED_LENGTH = 64;

export type PasswordWeakReason = 'too_short' | 'too_weak';

export interface PasswordCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  reason: PasswordWeakReason | null;
  message: string | null;
  suggestions: string[];
}

const zxcvbn = new ZxcvbnFactory({
  dictionary: {
    ...common.dictionary,
    ...en.dictionary,
    product: ['logtide'],
  },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
  maxLength: SCORED_LENGTH,
});

const GENERIC_MESSAGE = 'Add more words or characters that are hard to guess.';

/** Words a password should not be built from: the user's email and name. */
export function passwordUserInputs(user: { email?: string | null; name?: string | null }): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t && t.length >= 3) out.add(t);
  };
  if (user.email) {
    add(user.email);
    add(user.email.split('@')[0]);
  }
  if (user.name) {
    add(user.name);
    user.name.split(/\s+/).forEach(add);
  }
  return [...out];
}

export function checkPasswordStrength(
  password: string,
  userInputs: Array<string | null | undefined> = [],
): PasswordCheck {
  const inputs = userInputs.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const result = zxcvbn.check(password.slice(0, SCORED_LENGTH), inputs);
  const score = result.score as PasswordCheck['score'];
  const suggestions = result.feedback.suggestions ?? [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, score, reason: 'too_short', message: 'Use at least 12 characters.', suggestions };
  }
  if (score < MIN_SCORE) {
    const warning = result.feedback.warning;
    return { ok: false, score, reason: 'too_weak', message: warning || GENERIC_MESSAGE, suggestions };
  }
  return { ok: true, score, reason: null, message: null, suggestions: [] };
}
