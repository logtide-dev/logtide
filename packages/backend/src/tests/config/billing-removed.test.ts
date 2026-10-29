import { describe, it, expect, afterEach, vi } from 'vitest';

const VARS = ['LOGTIDE_BILLING_API_URL', 'LOGTIDE_BILLING_API_TOKEN'] as const;

describe('removed billing variables', () => {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(VARS)('%s logs the removal warning and does not throw', async (name) => {
    for (const k of VARS) delete process.env[k];
    process.env[name] = 'https://ignored.example';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();

    await expect(import('../../config/index.js')).resolves.toBeDefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('were removed in 1.6.0 and are ignored'));
  });

  it('stays silent when neither is set', async () => {
    for (const k of VARS) delete process.env[k];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();

    await import('../../config/index.js');

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('were removed in 1.6.0'));
  });
});
