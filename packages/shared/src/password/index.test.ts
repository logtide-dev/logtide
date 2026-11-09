import { describe, it, expect } from 'vitest';
import { checkPasswordStrength, passwordUserInputs, PASSWORD_MIN_LENGTH } from './index.js';

describe('checkPasswordStrength', () => {
  it('requires 12 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    const r = checkPasswordStrength('12345678');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_short');
    expect(r.message).toBe('Use at least 12 characters.');
  });

  it.each(['123456789012', 'passwordpassword', 'Password1234!', 'qwertyuiopasdf'])(
    'refuses the weak password %s',
    (pw) => {
      const r = checkPasswordStrength(pw);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('too_weak');
      expect(r.message).toEqual(expect.any(String));
      expect(r.message!.length).toBeGreaterThan(0);
    },
  );

  it('refuses a password built from the user email', () => {
    const inputs = passwordUserInputs({ email: 'alex.rossi@northwind.example', name: 'Alex Rossi' });
    expect(checkPasswordStrength('alex.rossi2026!', inputs).ok).toBe(false);
  });

  it.each(['GiuseppePolli1!', 'Giuseppe2026!!', 'giuseppepolli2026', 'polli.giuseppe.99'])(
    'refuses %s built from the name or email plus a few characters',
    (pw) => {
      const inputs = passwordUserInputs({ email: 'giuseppe.polli@example.com', name: 'Giuseppe Polli' });
      const r = checkPasswordStrength(pw, inputs);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('too_weak');
    },
  );

  it('still accepts a passphrase that only shares a short word with the name', () => {
    const inputs = passwordUserInputs({ email: 'rose@example.com', name: 'Rose Smith' });
    expect(checkPasswordStrength('rose-garden-tidal-orbit-57', inputs).ok).toBe(true);
    expect(checkPasswordStrength('tidal-Orbit-Granite-57', inputs).ok).toBe(true);
  });

  it('refuses the product name plus a year', () => {
    expect(checkPasswordStrength('Logtide2026!!').ok).toBe(false);
  });

  it('refuses a password built from the product name', () => {
    expect(checkPasswordStrength('logtide-logtide-1').ok).toBe(false);
  });

  it.each(['correct horse battery staple', 'tidal-Orbit-Granite-57'])('accepts the passphrase %s', (pw) => {
    const r = checkPasswordStrength(pw);
    expect(r).toMatchObject({ ok: true, reason: null, message: null });
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it('ignores empty user inputs', () => {
    expect(passwordUserInputs({ email: null, name: null })).toEqual([]);
    expect(checkPasswordStrength('tidal-Orbit-Granite-57', passwordUserInputs({ name: '' })).ok).toBe(true);
  });

  it('answers fast for very long input', () => {
    const start = performance.now();
    checkPasswordStrength('aZ9!'.repeat(2500));
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('handles accents and emoji', () => {
    const start = performance.now();
    const r = checkPasswordStrength('caffè-Ñandú-🦊-orbita-73');
    expect(performance.now() - start).toBeLessThan(500);
    expect(r.ok).toBe(true);
  });
});

describe('passwordUserInputs', () => {
  it('collects email, local part and name words', () => {
    expect(passwordUserInputs({ email: 'alex.rossi@northwind.example', name: 'Alex Rossi' })).toEqual(
      expect.arrayContaining(['alex.rossi@northwind.example', 'alex.rossi', 'Alex Rossi', 'Alex', 'Rossi']),
    );
  });
});
