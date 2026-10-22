import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { getApiUrl, completeItem } = vi.hoisted(() => ({
  getApiUrl: vi.fn(),
  completeItem: vi.fn(),
}));

vi.mock('$lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/config')>();
  return { ...actual, getApiUrl };
});
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem } }));

import CreateApiKeyDialog from './CreateApiKeyDialog.svelte';

const KEY = 'lp_0123456789abcdef';

async function createKey(onSubmit = vi.fn()) {
  onSubmit.mockResolvedValue({ apiKey: KEY, keyPrefix: 'lp_012345', type: 'write', message: 'ok' });
  render(CreateApiKeyDialog, { open: true, onSubmit });
  await fireEvent.input(await screen.findByLabelText('API key name'), { target: { value: 'Prod' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  await screen.findByText('API key created');
  return onSubmit;
}

function dsnText(): string {
  const label = screen.getByText(/^DSN/);
  return label.parentElement!.querySelector('div.font-mono')!.textContent!.trim();
}

function curlText(): string {
  return document.querySelector('pre code')!.textContent!;
}

describe('CreateApiKeyDialog', () => {
  beforeEach(() => {
    getApiUrl.mockReset();
    completeItem.mockReset();
  });

  it('dsn uses http and the port for an http install', async () => {
    getApiUrl.mockReturnValue('http://localhost:8080');
    await createKey();
    expect(dsnText()).toBe(`http://${KEY}@localhost:8080`);
  });

  it('dsn uses the page origin when the api url is relative', async () => {
    getApiUrl.mockReturnValue('');
    await createKey();
    const origin = new URL(window.location.origin);
    expect(dsnText()).toBe(`${origin.protocol.replace(':', '')}://${KEY}@${origin.host}`);
  });

  it('curl example sends Content-Type and valid JSON', async () => {
    getApiUrl.mockReturnValue('https://logs.example.com');
    await createKey();
    const curl = curlText();
    expect(curl).toContain('https://logs.example.com/api/v1/ingest');
    expect(curl).toContain('Content-Type: application/json');
    expect(curl).toContain(`X-API-Key: ${KEY}`);
    const body = curl.split("-d '")[1].replace(/'$/, '');
    const parsed = JSON.parse(body);
    expect(Array.isArray(parsed.logs)).toBe(true);
    expect(parsed.logs[0].message).toBeTruthy();
  });

  it('shows API key created, the prefix and no "successfully"', async () => {
    getApiUrl.mockReturnValue('https://logs.example.com');
    await createKey();
    expect(screen.getByText('Your API key was created.')).toBeInTheDocument();
    expect(screen.getByText('lp_012345')).toBeInTheDocument();
    expect(screen.getByText('Write-only')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/successfully/i);
    expect(completeItem).toHaveBeenCalledWith('create-api-key');
  });

  it('copy buttons have accessible names', async () => {
    getApiUrl.mockReturnValue('https://logs.example.com');
    await createKey();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy API key' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy DSN' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy cURL example' })).toBeInTheDocument();
    });
  });
});
