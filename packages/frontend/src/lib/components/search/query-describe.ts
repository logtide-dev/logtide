// Human-readable lines for every clause of a parsed query (export summary).

import type { BuiltinField, FieldClause, LogSearchQuery, TextTerm } from '@logtide/shared';

const BUILTIN_LABELS: Record<BuiltinField, string> = {
  level: 'Level',
  service: 'Service',
  hostname: 'Host',
  traceId: 'Trace',
  sessionId: 'Session',
  spanId: 'Span',
};

function fieldLabel(field: FieldClause['field']): string {
  return 'builtin' in field ? BUILTIN_LABELS[field.builtin] : `Metadata ${field.metadata}`;
}

function quoted(term: TextTerm): string {
  return `"${term.value}"`;
}

function describeField(clause: FieldClause): string {
  const label = fieldLabel(clause.field);
  switch (clause.op) {
    case 'equals':
      return `${label} is ${clause.value ?? ''}`;
    case 'not_equals':
      return `${label} is not ${clause.value ?? ''}`;
    case 'in':
      return `${label} is one of ${clause.values.join(', ')}`;
    case 'not_in':
      return `${label} is none of ${clause.values.join(', ')}`;
    case 'exists':
      return `${label} exists`;
    case 'not_exists':
      return `${label} does not exist`;
    case 'contains':
      return `${label} contains ${clause.value ?? ''}`;
  }
}

/** One line per clause: free text (all, any-of, none) first, then field clauses in order. */
export function describeQuery(query: LogSearchQuery): string[] {
  const lines: string[] = [];
  for (const term of query.text.all) {
    lines.push(term.kind === 'word' ? `Message contains the word ${quoted(term)}` : `Message contains ${quoted(term)}`);
  }
  for (const group of query.text.anyOf) {
    lines.push(`Message contains any of ${group.map(quoted).join(', ')}`);
  }
  for (const term of query.text.none) {
    lines.push(`Message does not contain ${quoted(term)}`);
  }
  for (const clause of query.fields) lines.push(describeField(clause));
  return lines;
}
