// Standard VAT rates for the 27 EU member states. MUST stay in sync with the
// marketing site (logtide.dev, src/data/eu-vat-rates.ts) so the pricing page
// and this page show identical numbers. Stripe Tax computes the exact amount
// at checkout; this is display only.

export interface EuCountry {
  name: string;
  /** Standard VAT rate in percent. */
  vat: number;
}

export const EU_COUNTRIES: Record<string, EuCountry> = {
  AT: { name: 'Austria', vat: 20 },
  BE: { name: 'Belgium', vat: 21 },
  BG: { name: 'Bulgaria', vat: 20 },
  HR: { name: 'Croatia', vat: 25 },
  CY: { name: 'Cyprus', vat: 19 },
  CZ: { name: 'Czechia', vat: 21 },
  DK: { name: 'Denmark', vat: 25 },
  EE: { name: 'Estonia', vat: 24 },
  FI: { name: 'Finland', vat: 25.5 },
  FR: { name: 'France', vat: 20 },
  DE: { name: 'Germany', vat: 19 },
  GR: { name: 'Greece', vat: 24 },
  HU: { name: 'Hungary', vat: 27 },
  IE: { name: 'Ireland', vat: 23 },
  IT: { name: 'Italy', vat: 22 },
  LV: { name: 'Latvia', vat: 21 },
  LT: { name: 'Lithuania', vat: 21 },
  LU: { name: 'Luxembourg', vat: 17 },
  MT: { name: 'Malta', vat: 18 },
  NL: { name: 'Netherlands', vat: 21 },
  PL: { name: 'Poland', vat: 23 },
  PT: { name: 'Portugal', vat: 23 },
  RO: { name: 'Romania', vat: 21 },
  SK: { name: 'Slovakia', vat: 23 },
  SI: { name: 'Slovenia', vat: 22 },
  ES: { name: 'Spain', vat: 21 },
  SE: { name: 'Sweden', vat: 25 },
};

/** IANA time zones of EU capitals and major cities mapped to a country code. */
export const TIMEZONE_COUNTRY: Record<string, string> = {
  'Europe/Vienna': 'AT',
  'Europe/Brussels': 'BE',
  'Europe/Sofia': 'BG',
  'Europe/Zagreb': 'HR',
  'Asia/Nicosia': 'CY',
  'Europe/Nicosia': 'CY',
  'Europe/Prague': 'CZ',
  'Europe/Copenhagen': 'DK',
  'Europe/Tallinn': 'EE',
  'Europe/Helsinki': 'FI',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE',
  'Europe/Athens': 'GR',
  'Europe/Budapest': 'HU',
  'Europe/Dublin': 'IE',
  'Europe/Rome': 'IT',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Luxembourg': 'LU',
  'Europe/Malta': 'MT',
  'Europe/Amsterdam': 'NL',
  'Europe/Warsaw': 'PL',
  'Europe/Lisbon': 'PT',
  'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT',
  'Europe/Bucharest': 'RO',
  'Europe/Bratislava': 'SK',
  'Europe/Ljubljana': 'SI',
  'Europe/Madrid': 'ES',
  'Atlantic/Canary': 'ES',
  'Europe/Stockholm': 'SE',
};

/** Price including VAT in integer minor units (cents). */
export function priceWithVatMinor(amountMinor: number, vatPercent: number): number {
  return Math.round((amountMinor * (100 + vatPercent)) / 100);
}

/** EU country code for an IANA time zone, or 'OUT' when unknown. */
export function guessCountry(timeZone: string | undefined): string {
  if (timeZone && TIMEZONE_COUNTRY[timeZone]) return TIMEZONE_COUNTRY[timeZone];
  return 'OUT';
}

/** "22" or "25.5": the rate without trailing zeros. */
export function formatVatRate(vatPercent: number): string {
  return String(vatPercent);
}

export interface VatView {
  audience: 'personal' | 'business';
  country: string;
}

/** VAT rate to add to displayed prices: only personal viewers in an EU country see VAT included. */
export function displayVatRate(view: VatView): number | null {
  if (view.audience !== 'personal') return null;
  return isEuCountry(view.country) ? EU_COUNTRIES[view.country].vat : null;
}

/** Amount to display for a net price under the viewer's VAT choice. */
export function displayAmount(amountMinor: number, view: VatView): number {
  const rate = displayVatRate(view);
  return rate === null ? amountMinor : priceWithVatMinor(amountMinor, rate);
}

/** Footer note under the plan cards. */
export function vatNote(view: VatView): string {
  const rate = displayVatRate(view);
  if (rate !== null) {
    return `Prices include ${formatVatRate(rate)}% VAT (${EU_COUNTRIES[view.country].name}). The exact tax is calculated at checkout from your billing address.`;
  }
  if (view.country === 'OUT' || !isEuCountry(view.country)) {
    return 'Prices exclude taxes. Applicable taxes are calculated at checkout from your billing address.';
  }
  return 'Prices exclude VAT. EU businesses with a valid VAT ID pay no VAT (reverse charge). Tax is calculated at checkout.';
}

/** Short suffix for the Current plan card sub-line. */
export function vatSuffix(view: VatView): string {
  return displayVatRate(view) !== null ? 'including VAT' : 'excluding VAT';
}

/** True for the 27 EU member state codes. */
export function isEuCountry(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(EU_COUNTRIES, code);
}
