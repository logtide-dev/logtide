import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'logtide_billing_vat';

function mockTz(tz: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: tz } as never);
}

async function fresh() {
  vi.resetModules();
  return (await import('./billing-vat')).billingVat;
}

describe('billingVat store', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults from the timezone: EU is personal', async () => {
    mockTz('Europe/Rome');
    expect((await fresh()).get()).toEqual({ audience: 'personal', country: 'IT' });
  });

  it('defaults outside the EU to business', async () => {
    mockTz('America/New_York');
    expect((await fresh()).get()).toEqual({ audience: 'business', country: 'OUT' });
  });

  it('restores a persisted choice', async () => {
    mockTz('America/New_York');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'business', country: 'DE' }));
    expect((await fresh()).get()).toEqual({ audience: 'business', country: 'DE' });
  });

  it('ignores invalid stored values', async () => {
    mockTz('Europe/Paris');
    localStorage.setItem(KEY, '{nope');
    expect((await fresh()).get().country).toBe('FR');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'x', country: 'DE' }));
    expect((await fresh()).get().country).toBe('FR');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'personal', country: 'ZZ' }));
    expect((await fresh()).get().country).toBe('FR');
  });

  it('unknown time zone uses navigator.language for the default', async () => {
    mockTz('Etc/Unknown');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('it-IT');
    expect((await fresh()).get()).toEqual({ audience: 'personal', country: 'IT' });
  });

  it('personal while OUT uses the language region when the time zone is unknown', async () => {
    mockTz('America/New_York');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'business', country: 'OUT' }));
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    const s = await fresh();
    s.setAudience('personal');
    expect(s.get().country).toBe('FR');
  });

  it('persists changes', async () => {
    mockTz('Europe/Rome');
    const s = await fresh();
    s.setCountry('ES');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ audience: 'personal', country: 'ES' });
  });

  it('personal while OUT switches to the guess, or IT', async () => {
    mockTz('Europe/Berlin');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'business', country: 'OUT' }));
    let s = await fresh();
    s.setAudience('personal');
    expect(s.get()).toEqual({ audience: 'personal', country: 'DE' });

    vi.restoreAllMocks();
    mockTz('America/New_York');
    localStorage.setItem(KEY, JSON.stringify({ audience: 'business', country: 'OUT' }));
    s = await fresh();
    s.setAudience('personal');
    expect(s.get()).toEqual({ audience: 'personal', country: 'IT' });
  });

  it('survives blocked localStorage', async () => {
    mockTz('Europe/Rome');
    const s = await fresh();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    s.setCountry('FR');
    expect(s.get().country).toBe('FR');
  });
});
