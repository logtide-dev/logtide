import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { getApiUrl } from './config';

function visit(url: string) {
  vi.stubGlobal('location', new URL(url));
}

describe('getApiUrl', () => {
  beforeEach(() => {
    delete window.__LOGTIDE_CONFIG__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__LOGTIDE_CONFIG__;
  });

  it('uses the configured API URL', () => {
    window.__LOGTIDE_CONFIG__ = { apiUrl: 'https://api.example.com' };
    visit('http://192.168.1.100:3000/');
    expect(getApiUrl()).toBe('https://api.example.com');
  });

  it('keeps an empty configured API URL', () => {
    window.__LOGTIDE_CONFIG__ = { apiUrl: '' };
    visit('http://192.168.1.100:3000/');
    expect(getApiUrl()).toBe('');
  });

  it('detects the backend on the host the page was opened on', () => {
    window.__LOGTIDE_CONFIG__ = {};
    visit('http://192.168.1.100:3000/');
    expect(getApiUrl()).toBe('http://192.168.1.100:8080');
  });

  it('detects the backend on the configured host port', () => {
    window.__LOGTIDE_CONFIG__ = { apiPort: '8111' };
    visit('http://192.168.1.100:8110/');
    expect(getApiUrl()).toBe('http://192.168.1.100:8111');
  });

  it('uses same origin on a standard port', () => {
    window.__LOGTIDE_CONFIG__ = { apiPort: '8111' };
    visit('https://logs.example.com/');
    expect(getApiUrl()).toBe('');
  });
});
