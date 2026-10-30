// Word tokenizer and metadata value text form (spec 5.3, plan D3).

const WORD_RUN = /[\p{L}\p{N}_]+/gu;

/**
 * Split text into lowercase word tokens: maximal runs of Unicode letters,
 * digits and `_`. Every engine and the matcher use this definition.
 */
export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(WORD_RUN) ?? [];
}

/**
 * The text form a metadata value is compared by: strings as they are,
 * finite numbers via String(), booleans as 'true' / 'false'. Null, objects,
 * arrays, undefined and non-finite numbers have no text form.
 */
export function metadataValueText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}
