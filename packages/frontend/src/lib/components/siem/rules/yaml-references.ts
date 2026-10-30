const MAX_REFERENCES = 10;

/**
 * Pulls the `references` list out of a Sigma rule YAML text without a YAML
 * parser. Handles the block list and the inline `[a, b]` forms, which are the
 * only two Sigma uses; anything else yields an empty list.
 */
export function extractReferences(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^references\s*:/.test(l));
  if (start === -1) return [];

  const inline = lines[start].replace(/^references\s*:\s*/, '').trim();
  const found: string[] = [];

  if (inline.startsWith('[')) {
    for (const part of inline.replace(/^\[|\]$/g, '').split(',')) {
      found.push(clean(part));
    }
  } else {
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const m = /^\s*-\s+(.*)$/.exec(line);
      if (!m) break;
      found.push(clean(m[1]));
    }
  }

  return found.filter((u) => /^https?:\/\//i.test(u)).slice(0, MAX_REFERENCES);
}

function clean(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}
