// Dashboard variables in metrics filters: a value "$name" takes the variable's
// current value; an unset (null / empty) variable drops the whole filter; an
// unknown variable is a validation error.
//
// This is the one rule for "is this a variable": only "$" followed by a valid
// variable name (DASHBOARD_VARIABLE_NAME_RE) is a reference. Anything else
// that starts with "$" ("$5", "$", "$Foo") is a literal value. The query
// schema, the dashboard document checks and the alert config all use it.

import type { MetricAttrFilter } from '@logtide/shared';
import { DASHBOARD_VARIABLE_NAME_RE } from '@logtide/shared';
import { MetricQueryValidationError } from './errors.js';

/** The variable name a value refers to, or null when the value is a literal. */
export function variableName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 2 || value[0] !== '$') return null;
  const name = value.slice(1);
  return DASHBOARD_VARIABLE_NAME_RE.test(name) ? name : null;
}

/** Whether a value is a "$name" variable reference. */
export function isVariableRef(value: unknown): value is string {
  return variableName(value) !== null;
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
