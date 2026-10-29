import { describe, it, expect } from 'vitest';
import { tokenizeWords, metadataValueText } from './tokenize.js';
import { isValidFieldKey, resolveFieldKey } from './keys.js';

describe('tokenizeWords', () => {
  it.each([
    ['Request timeout after 30s', ['request', 'timeout', 'after', '30s']],
    ['user_id 99 not found', ['user_id', '99', 'not', 'found']],
    ['proxy to api.example.com failed', ['proxy', 'to', 'api', 'example', 'com', 'failed']],
    ['error-prone retry logic', ['error', 'prone', 'retry', 'logic']],
    ['Paiement échoué pour la commande 77', ['paiement', 'échoué', 'pour', 'la', 'commande', '77']],
    ['ОШИБКА повторилась', ['ошибка', 'повторилась']],
    ['東京リージョンで障害', ['東京リージョンで障害']],
    ['', []],
    ['::!!', []],
  ])('splits %j', (input, expected) => expect(tokenizeWords(input)).toEqual(expected));
});

describe('metadataValueText', () => {
  it.each([
    ['a', 'a'],
    [500, '500'],
    [false, 'false'],
    ['', ''],
  ])('%j has text %j', (v, t) => expect(metadataValueText(v)).toBe(t));
  it.each([null, undefined, {}, ['a'], Number.NaN])('%j has no text form', (v) =>
    expect(metadataValueText(v)).toBeUndefined()
  );
});

describe('field keys', () => {
  it.each(['env', 'user.id', 'x-request-id', '_k', 'http.status_code', 'Error'])('%j is valid', (k) =>
    expect(isValidFieldKey(k)).toBe(true)
  );
  it.each(['', '12', '9k', '.a', 'a.', 'a..b', 'bad key', 'a:b', 'x'.repeat(201)])('%j is invalid', (k) =>
    expect(isValidFieldKey(k)).toBe(false)
  );
  it.each([
    ['host', { builtin: 'hostname' }],
    ['hostname', { builtin: 'hostname' }],
    ['trace_id', { builtin: 'traceId' }],
    ['session', { builtin: 'sessionId' }],
    ['span', { builtin: 'spanId' }],
    ['Level', { metadata: 'Level' }],
    ['bad key', null],
  ])('resolveFieldKey(%j)', (k, ref) => expect(resolveFieldKey(k)).toEqual(ref));
  it('exports from the package index', async () => {
    const shared = await import('../index.js');
    expect(typeof shared.tokenizeWords).toBe('function');
    expect(shared.BUILTIN_FIELD_KEYS.hostname).toBe('host');
  });
});
