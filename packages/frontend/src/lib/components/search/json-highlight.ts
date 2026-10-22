// Syntax segments for pretty-printed JSON text. Everything is returned as
// plain-text segments: callers render them as text nodes, never with {@html}.

export type JsonSegmentKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct';

export interface JsonSegment {
  text: string;
  kind: JsonSegmentKind;
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\bnull\b/g;

/** Splits JSON text into segments that cover every character once. */
export function jsonSegments(text: string): JsonSegment[] {
  const out: JsonSegment[] = [];
  let cursor = 0;
  const push = (segment: JsonSegment) => {
    if (segment.text) out.push(segment);
  };
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    push({ text: text.slice(cursor, start), kind: 'punct' });
    if (match[1] !== undefined) {
      push({ text: match[1], kind: match[2] !== undefined ? 'key' : 'string' });
      if (match[2] !== undefined) push({ text: match[2], kind: 'punct' });
    } else if (match[3] !== undefined) {
      push({ text: match[3], kind: 'number' });
    } else if (match[4] !== undefined) {
      push({ text: match[4], kind: 'boolean' });
    } else {
      push({ text: match[0], kind: 'null' });
    }
    cursor = start + match[0].length;
  }
  push({ text: text.slice(cursor), kind: 'punct' });
  return out;
}

/**
 * Display-only tweak: a string value keeps its escaped `\n` visible and also
 * breaks the line there, so stack traces stay readable. The copied and
 * downloaded JSON is never touched.
 */
export function breakEscapedNewlines(segment: JsonSegment): JsonSegment {
  if (segment.kind !== 'string' || !segment.text.includes('\\n')) return segment;
  return { ...segment, text: segment.text.replace(/\\n/g, '\\n\n') };
}

export const jsonClass: Record<JsonSegmentKind, string> = {
  key: 'text-info-text',
  string: 'text-success-text',
  number: 'text-warning-text',
  boolean: 'text-primary-text',
  null: 'text-muted-foreground italic',
  punct: 'text-muted-foreground',
};
