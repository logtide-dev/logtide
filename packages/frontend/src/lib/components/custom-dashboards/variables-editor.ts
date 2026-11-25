import { DASHBOARD_VARIABLE_NAME_RE, type DashboardVariable } from '@logtide/shared';

/** One message per variable (null = valid): name format, uniqueness, attribute key. */
export function validateVariables(variables: DashboardVariable[]): Array<string | null> {
  const seen = new Map<string, number>();
  for (const v of variables) seen.set(v.name, (seen.get(v.name) ?? 0) + 1);
  return variables.map((v) => {
    if (!DASHBOARD_VARIABLE_NAME_RE.test(v.name)) {
      return 'Name must start with a lowercase letter and use only a-z, 0-9 and _ (max 32).';
    }
    if ((seen.get(v.name) ?? 0) > 1) return 'Name is already used by another variable.';
    if (!v.attr.key.trim()) return 'Pick an attribute key.';
    return null;
  });
}
