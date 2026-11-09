import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import PasswordStrengthField from './PasswordStrengthField.svelte';

function setup(user: { email?: string; name?: string } = {}) {
  const state = { ok: false };
  render(PasswordStrengthField, {
    props: {
      id: 'pw',
      label: 'Password',
      user,
      onCheck: (ok: boolean) => {
        state.ok = ok;
      },
    },
  });
  const input = screen.getByLabelText('Password') as HTMLInputElement;
  return { input, state };
}

describe('PasswordStrengthField', () => {
  it('explains a short password and stays not ok', async () => {
    const { input, state } = setup();
    await fireEvent.input(input, { target: { value: '12345678' } });
    await waitFor(() => expect(screen.getByText('Use at least 12 characters.')).toBeTruthy());
    expect(state.ok).toBe(false);
  });

  it('marks a passphrase as strong', async () => {
    const { input, state } = setup();
    await fireEvent.input(input, { target: { value: 'tidal-Orbit-Granite-57' } });
    await waitFor(() => expect(screen.getByText('Strong')).toBeTruthy());
    expect(state.ok).toBe(true);
  });

  it('refuses a password built from the user email', async () => {
    const { input, state } = setup({ email: 'alex.rossi@northwind.example', name: 'Alex Rossi' });
    await fireEvent.input(input, { target: { value: 'alex.rossi2026!' } });
    await waitFor(() => expect(screen.getByText(/^(Weak|Fair)$/)).toBeTruthy());
    expect(state.ok).toBe(false);
  });

  it('toggles visibility', async () => {
    const { input } = setup();
    expect(input.type).toBe('password');
    await fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
  });
});
