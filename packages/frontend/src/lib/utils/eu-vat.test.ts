import { describe, it, expect } from 'vitest';
import { EU_COUNTRIES, TIMEZONE_COUNTRY, priceWithVatMinor, guessCountry, formatVatRate } from './eu-vat';

describe('eu-vat', () => {
  it('has the 27 member states', () => {
    expect(Object.keys(EU_COUNTRIES)).toHaveLength(27);
    expect(EU_COUNTRIES.IT).toEqual({ name: 'Italy', vat: 22 });
    expect(EU_COUNTRIES.FI.vat).toBe(25.5);
  });

  it('maps every timezone to a known country', () => {
    for (const code of Object.values(TIMEZONE_COUNTRY)) expect(EU_COUNTRIES[code]).toBeDefined();
  });

  it('adds VAT in integer minor units', () => {
    expect(priceWithVatMinor(2900, 22)).toBe(3538);
    expect(priceWithVatMinor(9900, 25.5)).toBe(12425);
    expect(priceWithVatMinor(28800, 19)).toBe(34272);
    expect(priceWithVatMinor(0, 22)).toBe(0);
  });

  it('guesses the country from a timezone', () => {
    expect(guessCountry('Europe/Rome')).toBe('IT');
    expect(guessCountry('America/New_York')).toBe('OUT');
    expect(guessCountry(undefined)).toBe('OUT');
  });

  it('unknown time zone falls back to navigator.language region', () => {
    expect(guessCountry('Etc/Unknown', 'it-IT')).toBe('IT');
    expect(guessCountry(undefined, 'de-DE')).toBe('DE');
    expect(guessCountry('Europe/Rome', 'de-DE')).toBe('IT');
  });

  it('non-EU language region gives OUT', () => {
    expect(guessCountry('America/New_York', 'en-US')).toBe('OUT');
    expect(guessCountry(undefined, 'en')).toBe('OUT');
  });

  it('formats decimal rates without trailing zeros', () => {
    expect(formatVatRate(25.5)).toBe('25.5');
    expect(formatVatRate(22)).toBe('22');
  });
});
