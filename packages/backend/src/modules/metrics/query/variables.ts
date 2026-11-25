// Dashboard variables in metrics filters: a value "$name" takes the variable's
// current value; an unset (null / empty) variable drops the whole filter; an
// unknown variable is a validation error.

import type { MetricAttrFilter } from '@logtide/shared';
import { MetricQueryValidationError } from './errors.js';

const VARIABLE_RE = /^\$([a-z][a-z0-9_]{0,31})$/;

export function variableName(value: string): string | null {
  const m = VARIABLE_RE.exec(value);
  return m ? m[1] : null;
}

/**
 * Resolve one string that may be a variable reference. Returns the literal
 * value, the variable's value, or null when the variable is unset.
 */
export function resolveVariableValue(
  value: string,
  variables: Record<string, string | null> | undefined,
): string | null {
  const name = variableName(value);
  if (name === null) return value;
  if (!variables || !Object.prototype.hasOwnProperty.call(variables, name)) {
    throw new MetricQueryValidationError(`Unknown variable "$${name}"`);
  }
  const resolved = variables[name];
  return resolved === null || resolved === undefined || resolved === '' ? null : resolved;
}

export function resolveFilterVariables(
  filters: MetricAttrFilter[],
  variables: Record<string, string | null> | undefined,
): MetricAttrFilter[] {
  const out: MetricAttrFilter[] = [];
  for (const filter of filters) {
    if (!filter.values || filter.values.length === 0) {
      out.push(filter);
      continue;
    }
    let drop = false;
    const values: string[] = [];
    for (const v of filter.values) {
      const resolved = resolveVariableValue(v, variables);
      if (resolved === null) drop = true;
      else values.push(resolved);
    }
    if (!drop) out.push({ ...filter, values });
  }
  return out;
}
