import { describe, it, expect } from 'vitest';
import { buildRuntimeConfig } from './runtime-config';

describe('buildRuntimeConfig', () => {
  it('uses an explicit API URL as it is', () => {
    expect(buildRuntimeConfig('https://api.example.com', '8111')).toEqual({
      apiUrl: 'https://api.example.com',
    });
  });

  it('keeps an empty API URL, which means same origin', () => {
    expect(buildRuntimeConfig('', '8111')).toEqual({ apiUrl: '' });
  });

  it('falls back to same origin when the API URL is not set', () => {
    expect(buildRuntimeConfig(undefined, undefined)).toEqual({ apiUrl: '' });
  });

  it('leaves the API URL out on auto so the browser detects it', () => {
    expect(buildRuntimeConfig('auto', '8111')).toEqual({ apiPort: '8111' });
  });

  it('has no port on auto when the backend port is not set', () => {
    expect(buildRuntimeConfig('auto', undefined)).toEqual({});
    expect(buildRuntimeConfig('auto', '')).toEqual({});
  });
});
