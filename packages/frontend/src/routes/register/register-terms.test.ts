import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { getAuthConfig, getProviders, register } = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  getProviders: vi.fn(),
  register: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getAuthConfig, getProviders, register },
}));

import RegisterPage from './+page.svelte';
import { page } from '../../test-stubs/app-state';

const LOCAL = {
  id: 'p-local',
  type: 'local',
  name: 'Email',
  slug: 'local',
  icon: null,
  isDefault: true,
  displayOrder: 0,
  supportsRedirect: false,
};

async function fillForm() {
  await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Jane' } });
  await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
  await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  await fireEvent.input(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Create account with Email' }) as HTMLButtonElement;
}

describe('/register terms checkbox', () => {
  beforeEach(() => {
    localStorage.clear();
    getAuthConfig.mockReset();
    getProviders.mockReset();
    register.mockReset();
    page.url = new URL('http://localhost/register');
    getProviders.mockResolvedValue({ providers: [LOCAL] });
    // Rejecting keeps the page on the form after submit (no navigation needed).
    register.mockRejectedValue(new Error('stop'));
  });

  it('shows no checkbox and sends no acceptTerms when terms are not configured', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    render(RegisterPage);
    await fillForm();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(submitButton().disabled).toBe(false);
    await fireEvent.click(submitButton());
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toEqual({ name: 'Jane', email: 'jane@example.com', password: 'password123' });
  });

  it('requires the checkbox when terms are configured and sends acceptTerms', async () => {
    getAuthConfig.mockResolvedValue({
      authMode: 'standard',
      signupEnabled: true,
      termsUrl: 'https://example.com/terms',
      privacyUrl: 'https://example.com/privacy',
      termsVersion: '2026-10-19',
    });
    render(RegisterPage);
    await fillForm();

    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.required).toBe(true);
    const terms = screen.getByRole('link', { name: 'Terms of Service' });
    const privacy = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(terms.getAttribute('href')).toBe('https://example.com/terms');
    expect(privacy.getAttribute('href')).toBe('https://example.com/privacy');
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(privacy.getAttribute('target')).toBe('_blank');
    expect(submitButton().disabled).toBe(true);

    await fireEvent.click(checkbox);
    expect(submitButton().disabled).toBe(false);
    await fireEvent.click(submitButton());
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      password: 'password123',
      acceptTerms: true,
    });
  });
});
