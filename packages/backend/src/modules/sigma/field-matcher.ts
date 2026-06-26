/**
 * SigmaFieldMatcher - Field matching with wildcards and modifier chains
 *
 * Implements the SigmaHQ field-modifier model:
 * - Transforms (rewrite the pattern, applied left to right): base64,
 *   base64offset, utf16le/utf16/utf16be/wide, windash
 * - Comparators (final match operator): contains, startswith, endswith, re,
 *   cidr, gt, gte, lt, lte, exists. Default (none) is equals-with-wildcards.
 * - Quantifier: all (over a value list, flips the default OR into AND)
 *
 * Whole modifier chains are honored (e.g. CommandLine|utf16le|base64offset|contains),
 * not just the first modifier.
 */

export type FieldModifier =
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'base64'
  | 'base64offset'
  | 're'
  | 'cidr'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'all'
  | 'exists'
  | 'utf16le'
  | 'utf16'
  | 'utf16be'
  | 'wide'
  | 'windash';

export interface FieldMatchOptions {
  caseSensitive?: boolean;
  modifier?: FieldModifier;
}

type Comparator = 'contains' | 'startswith' | 'endswith' | 're' | 'cidr' | 'gt' | 'gte' | 'lt' | 'lte';

const TRANSFORMS = new Set(['base64', 'base64offset', 'utf16le', 'utf16', 'utf16be', 'wide', 'windash']);
const COMPARATORS = new Set<Comparator>(['contains', 'startswith', 'endswith', 're', 'cidr', 'gt', 'gte', 'lt', 'lte']);

// Windows dash variants for the |windash modifier (ASCII hyphen, slash, and the
// unicode dashes accepted by Windows command parsers).
const WINDASH_CHARS = ['-', '/', '–', '—', '―'];

// Warn at most once per unknown modifier token so a malformed rule never throws
// and never silently disappears.
const warnedModifiers = new Set<string>();

/** Intermediate pattern representation while running the transform chain. */
type Candidate = { text: string } | { bytes: Buffer };

export class SigmaFieldMatcher {
  /**
   * Match a field value against a pattern with an optional single modifier.
   * Kept for backward compatibility; chains are driven from matchSelection.
   */
  static match(
    fieldValue: any,
    pattern: any,
    options: FieldMatchOptions = {}
  ): boolean {
    const { caseSensitive = false, modifier } = options;

    if (fieldValue === null || fieldValue === undefined) {
      return false;
    }

    // Handle arrays in pattern (OR logic - match if ANY pattern matches)
    if (Array.isArray(pattern)) {
      return pattern.some((p) => this.match(fieldValue, p, options));
    }

    if (modifier) {
      return this.applyModifierChain(fieldValue, pattern, [modifier], caseSensitive);
    }

    return this.matchWithWildcards(String(fieldValue), String(pattern), caseSensitive);
  }

  /**
   * Match a Sigma selection block against log data.
   *
   * @param logData - Log entry data (flattened object)
   * @param selection - Sigma selection block (field: value pairs)
   * @param caseSensitive - Case-sensitive matching
   * @returns true if ALL fields in selection match (AND logic)
   */
  static matchSelection(
    logData: Record<string, any>,
    selection: Record<string, any>,
    caseSensitive: boolean = false
  ): boolean {
    if (!selection || Object.keys(selection).length === 0) {
      return false;
    }

    return Object.entries(selection).every(([field, pattern]) => {
      const { fieldName, modifiers } = this.parseFieldWithModifier(field);
      const fieldValue = this.getNestedField(logData, fieldName);

      // |exists is a presence check, not a value match.
      if (modifiers.includes('exists')) {
        const exists = fieldValue !== null && fieldValue !== undefined;
        return pattern === true ? exists : !exists;
      }

      const requireAll = modifiers.includes('all');
      const chain = modifiers.filter((m) => m !== 'all');

      if (Array.isArray(pattern)) {
        // |all flips the default OR over a value list into AND.
        return requireAll
          ? pattern.every((p) => this.applyModifierChain(fieldValue, p, chain, caseSensitive))
          : pattern.some((p) => this.applyModifierChain(fieldValue, p, chain, caseSensitive));
      }

      return this.applyModifierChain(fieldValue, pattern, chain, caseSensitive);
    });
  }

  /**
   * Apply an ordered chain of modifiers (transforms + a final comparator) to a
   * single scalar pattern.
   */
  private static applyModifierChain(
    fieldValue: any,
    pattern: any,
    modifiers: string[],
    caseSensitive: boolean
  ): boolean {
    if (fieldValue === null || fieldValue === undefined) {
      return false;
    }

    const transforms: string[] = [];
    let comparator: Comparator | undefined;

    for (const m of modifiers) {
      if (TRANSFORMS.has(m)) {
        transforms.push(m);
      } else if (COMPARATORS.has(m as Comparator)) {
        comparator = m as Comparator; // last comparator wins
      } else if (m !== 'exists' && m !== 'all') {
        if (!warnedModifiers.has(m)) {
          warnedModifiers.add(m);
          console.warn(`[SigmaFieldMatcher] Unknown field modifier ignored: ${m}`);
        }
      }
    }

    const candidates = this.expandTransforms(String(pattern), transforms);

    // base64/base64offset are substring transforms in practice: imply contains
    // when no explicit comparator follows them.
    const hasEncoding = transforms.includes('base64') || transforms.includes('base64offset');
    const cmp = comparator ?? (hasEncoding ? 'contains' : undefined);

    return candidates.some((c) => this.matchComparator(fieldValue, c, cmp, caseSensitive));
  }

  /**
   * Run the pattern through the ordered transform list, fanning out into the set
   * of candidate strings that the comparator should be tested against.
   */
  private static expandTransforms(pattern: string, transforms: string[]): string[] {
    let items: Candidate[] = [{ text: pattern }];

    for (const t of transforms) {
      const next: Candidate[] = [];
      for (const item of items) {
        const asText = 'text' in item ? item.text : item.bytes.toString('latin1');

        switch (t) {
          case 'utf16le':
          case 'utf16': // treated as utf16le for matching purposes
          case 'wide':
            next.push({ bytes: Buffer.from(asText, 'utf16le') });
            break;
          case 'utf16be':
            next.push({ bytes: this.toUtf16be(asText) });
            break;
          case 'windash':
            for (const variant of this.windashVariants(asText)) {
              next.push({ text: variant });
            }
            break;
          case 'base64': {
            const buf = 'bytes' in item ? item.bytes : Buffer.from(item.text, 'utf8');
            next.push({ text: buf.toString('base64') });
            break;
          }
          case 'base64offset': {
            const buf = 'bytes' in item ? item.bytes : Buffer.from(item.text, 'utf8');
            for (const v of this.base64Offsets(buf)) {
              next.push({ text: v });
            }
            break;
          }
          default:
            next.push(item);
        }
      }
      items = next;
    }

    return items.map((i) => ('text' in i ? i.text : i.bytes.toString('latin1')));
  }

  /** Apply a single comparator between the field value and a candidate pattern. */
  private static matchComparator(
    fieldValue: any,
    candidate: string,
    comparator: Comparator | undefined,
    caseSensitive: boolean
  ): boolean {
    const valueStr = String(fieldValue);

    switch (comparator) {
      case undefined:
        return this.matchWithWildcards(valueStr, candidate, caseSensitive);
      case 'contains':
      case 'startswith':
      case 'endswith':
        return this.matchStringOp(valueStr, candidate, comparator, caseSensitive);
      case 're':
        return this.matchRegex(valueStr, candidate, caseSensitive);
      case 'cidr':
        return this.matchCidr(valueStr, candidate);
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return this.matchNumeric(fieldValue, candidate, comparator);
      default:
        return false;
    }
  }

  /** contains / startswith / endswith */
  private static matchStringOp(
    value: string,
    pattern: string,
    op: 'contains' | 'startswith' | 'endswith',
    caseSensitive: boolean
  ): boolean {
    const v = caseSensitive ? value : value.toLowerCase();
    const p = caseSensitive ? pattern : pattern.toLowerCase();

    switch (op) {
      case 'contains':
        return v.includes(p);
      case 'startswith':
        return v.startsWith(p);
      case 'endswith':
        return v.endsWith(p);
    }
  }

  /**
   * Match with wildcards (* and ?)
   */
  private static matchWithWildcards(
    value: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();
    const compareValue = caseSensitive ? value : value.toLowerCase();

    if (!comparePattern.includes('*') && !comparePattern.includes('?')) {
      return compareValue === comparePattern;
    }

    const regexPattern = this.wildcardToRegex(comparePattern);
    const regex = new RegExp(`^${regexPattern}$`, caseSensitive ? '' : 'i');

    return regex.test(value);
  }

  /**
   * Convert wildcard pattern to regex
   */
  private static wildcardToRegex(pattern: string): string {
    return pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // * -> .*
      .replace(/\?/g, '.'); // ? -> .
  }

  /**
   * Match with regex pattern
   */
  private static matchRegex(
    value: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    try {
      const flags = caseSensitive ? '' : 'i';
      const regex = new RegExp(pattern, flags);
      return regex.test(value);
    } catch (error) {
      console.warn(`[SigmaFieldMatcher] Invalid regex pattern: ${pattern}`, error);
      return false;
    }
  }

  /** IPv4 CIDR membership test. Non-IPv4 input or malformed CIDR -> no match. */
  private static matchCidr(value: string, cidr: string): boolean {
    const slash = cidr.indexOf('/');
    if (slash === -1) {
      // Bare address: treat as /32 equality.
      const ip = this.ipv4ToInt(value);
      const range = this.ipv4ToInt(cidr);
      return ip !== null && range !== null && ip === range;
    }

    const range = this.ipv4ToInt(cidr.slice(0, slash));
    const bits = Number(cidr.slice(slash + 1));
    const ip = this.ipv4ToInt(value);
    if (ip === null || range === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return false;
    }

    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (range & mask);
  }

  private static ipv4ToInt(ip: string): number | null {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return null;
    let result = 0;
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const n = Number(part);
      if (n > 255) return null;
      result = (result << 8) | n;
    }
    return result >>> 0;
  }

  /** Numeric comparison (gt/gte/lt/lte). Non-numeric input -> no match. */
  private static matchNumeric(value: any, pattern: string, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
    const a = typeof value === 'number' ? value : Number(value);
    const b = Number(pattern);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;

    switch (op) {
      case 'gt':
        return a > b;
      case 'gte':
        return a >= b;
      case 'lt':
        return a < b;
      case 'lte':
        return a <= b;
    }
  }

  /** Encode a string as UTF-16BE bytes. */
  private static toUtf16be(text: string): Buffer {
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1];
      be[i + 1] = le[i];
    }
    return be;
  }

  /** Replace every ASCII hyphen with each Windows dash variant. */
  private static windashVariants(pattern: string): string[] {
    if (!pattern.includes('-')) return [pattern];
    return WINDASH_CHARS.map((c) => pattern.split('-').join(c));
  }

  /**
   * SigmaHQ base64offset: produce the three encodings covering the possible
   * byte alignments of the pattern inside a larger base64 blob.
   */
  private static base64Offsets(buf: Buffer): string[] {
    const startOffsets = [0, 2, 3];
    const endOffsets: Array<number | null> = [null, -3, -2];
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      const prefixed = Buffer.concat([Buffer.alloc(i, 0x20), buf]);
      const encoded = prefixed.toString('base64');
      const start = startOffsets[i];
      const end = endOffsets[i];
      results.push(end === null ? encoded.slice(start) : encoded.slice(start, end));
    }

    return results;
  }

  /**
   * Parse a field name with its (possibly chained) modifiers.
   * Example: "CommandLine|utf16le|base64offset|contains" ->
   *   { fieldName: "CommandLine", modifiers: ["utf16le", "base64offset", "contains"] }
   */
  private static parseFieldWithModifier(field: string): {
    fieldName: string;
    modifiers: string[];
  } {
    const parts = field.split('|');
    return { fieldName: parts[0], modifiers: parts.slice(1) };
  }

  /**
   * Get nested field value using dot notation
   * Example: "metadata.user.id" -> logData.metadata.user.id
   */
  private static getNestedField(
    obj: Record<string, any>,
    path: string
  ): any {
    if (path in obj) {
      return obj[path];
    }

    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }
}
