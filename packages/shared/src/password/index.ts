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
const PERSONAL_MESSAGE = 'Do not build the password from your name, your email or the product name.';

/** Words a password should not be built from: the user's email and name. */
export function passwordUserInputs(user: { email?: string | null; name?: string | null }): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t && t.length >= 3) out.add(t);
  };
  if (user.email) {
    const local = user.email.split('@')[0];
    add(user.email);
    add(local);
    local.split(/[._+-]+/).forEach(add);
  }
  if (user.name) {
    add(user.name);
    add(user.name.replace(/\s+/g, ''));
    user.name.split(/\s+/).forEach(add);
  }
  return [...out];
}

/** Words of 4+ letters from the user inputs and the product name, lowercased, longest first. */
function personalWords(inputs: string[]): string[] {
  const words = new Set<string>(['logtide']);
  for (const input of inputs) {
    for (const word of input.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= 4) words.add(word);
    }
  }
  return [...words].sort((a, b) => b.length - a.length);
}

/**
 * zxcvbn only weighs the user inputs, so a name plus a year and a symbol can
 * still score 3. Remove every personal word and judge what is left: it must
 * still be long and strong on its own.
 */
function strongWithoutPersonalWords(password: string, inputs: string[]): boolean {
  const lower = password.toLowerCase();
  let rest = lower;
  for (const word of personalWords(inputs)) rest = rest.split(word).join('');
  if (rest === lower) return true;
  if (rest.length < PASSWORD_MIN_LENGTH) return false;
  return zxcvbn.check(rest.slice(0, SCORED_LENGTH), inputs).score >= MIN_SCORE;
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
  if (!strongWithoutPersonalWords(password, inputs)) {
    return { ok: false, score, reason: 'too_weak', message: PERSONAL_MESSAGE, suggestions };
  }
  return { ok: true, score, reason: null, message: null, suggestions: [] };
}
