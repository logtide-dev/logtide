// Field key syntax and built-in aliases (spec 5.3, plan D1).

import { LOG_QUERY_LIMITS, type BuiltinField, type FieldRef } from './types.js';

const KEY_CHARS = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const BUILTIN_ALIASES: Record<string, BuiltinField> = {
  level: 'level',
  service: 'service',
  host: 'hostname',
  hostname: 'hostname',
  trace: 'traceId',
  trace_id: 'traceId',
  session: 'sessionId',
  session_id: 'sessionId',
  span: 'spanId',
  span_id: 'spanId',
};

/**
 * Key syntax without the length limit: starts with a letter or `_`, then
 * letters, digits, `_`, `.` or `-`, no trailing `.` and no `..`. The lexer
 * uses it so an over-long key is reported as such instead of becoming text.
 */
export function isFieldKeySyntax(key: string): boolean {
  return KEY_CHARS.test(key) && !key.endsWith('.') && !key.includes('..');
}

export function isValidFieldKey(key: string): boolean {
  return key.length <= LOG_QUERY_LIMITS.maxKeyLength && isFieldKeySyntax(key);
}

/** Built-in field for a key typed in the grammar (case-sensitive), if any. */
export function builtinForKey(key: string): BuiltinField | undefined {
  return Object.prototype.hasOwnProperty.call(BUILTIN_ALIASES, key) ? BUILTIN_ALIASES[key] : undefined;
}

/** Built-in aliases resolve to their typed field, other valid keys are metadata, invalid keys give null. */
export function resolveFieldKey(key: string): FieldRef | null {
  if (!isValidFieldKey(key)) return null;
  const builtin = builtinForKey(key);
  return builtin ? { builtin } : { metadata: key };
}
