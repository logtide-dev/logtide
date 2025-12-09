/**
 * SigmaFieldMatcher - Field matching with wildcards and modifiers
 *
 * Supports:
 * - Wildcards: * (any characters), ? (single character)
 * - Modifiers: contains, startswith, endswith, base64, re (regex)
 * - Case-insensitive matching
 */

export type FieldModifier = 'contains' | 'startswith' | 'endswith' | 'base64' | 're' | 'all' | 'base64offset' | 'exists';

export interface FieldMatchOptions {
  caseSensitive?: boolean;
  modifier?: FieldModifier;
}

export class SigmaFieldMatcher {
  /**
   * Match a field value against a pattern with optional modifiers
   */
  static match(
    fieldValue: any,
    pattern: any,
    options: FieldMatchOptions = {}
  ): boolean {
    const { caseSensitive = false, modifier } = options;

    // Handle null/undefined field values
    if (fieldValue === null || fieldValue === undefined) {
      return false;
    }

    // Convert field value to string for matching
    const valueStr = String(fieldValue);

    // Handle arrays in pattern (OR logic - match if ANY pattern matches)
    if (Array.isArray(pattern)) {
      return pattern.some((p) => this.match(fieldValue, p, options));
    }

    // Convert pattern to string
    const patternStr = String(pattern);

    // Apply modifier-specific matching
    if (modifier) {
      return this.matchWithModifier(valueStr, patternStr, modifier, caseSensitive);
    }

    // Default: exact match with optional wildcards
    return this.matchWithWildcards(valueStr, patternStr, caseSensitive);
  }

  /**
   * Match with field modifiers
   */
  private static matchWithModifier(
    value: string,
    pattern: string,
    modifier: FieldModifier,
    caseSensitive: boolean
  ): boolean {
    const compareValue = caseSensitive ? value : value.toLowerCase();
    const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();

    switch (modifier) {
      case 'contains':
        return compareValue.includes(comparePattern);

      case 'startswith':
        return compareValue.startsWith(comparePattern);

      case 'endswith':
        return compareValue.endsWith(comparePattern);

      case 'base64':
        return this.matchBase64(value, pattern, caseSensitive);

      case 'base64offset':
        return this.matchBase64Offset(value, pattern, caseSensitive);

      case 're':
        return this.matchRegex(value, pattern, caseSensitive);

      case 'all':
        // 'all' modifier means match all words in any order
        return this.matchAllWords(value, pattern, caseSensitive);

      default:
        return false;
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
    const compareValue = caseSensitive ? value : value.toLowerCase();
    const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();

    // If no wildcards, do exact match
    if (!comparePattern.includes('*') && !comparePattern.includes('?')) {
      return compareValue === comparePattern;
    }

    // Convert wildcard pattern to regex
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
      .replace(/\*/g, '.*') // * → .*
      .replace(/\?/g, '.'); // ? → .
  }

  /**
   * Match base64-encoded values
   */
  private static matchBase64(
    value: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    try {
      // Decode base64 value
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      const compareValue = caseSensitive ? decoded : decoded.toLowerCase();
      const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();

      return compareValue.includes(comparePattern);
    } catch (error) {
      // Invalid base64, no match
      return false;
    }
  }

  /**
   * Match base64-encoded values at any offset
   */
  private static matchBase64Offset(
    value: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    // Try matching at different offsets (0, 1, 2 bytes)
    for (let offset = 0; offset < 3; offset++) {
      try {
        const paddedValue = '='.repeat(offset) + value;
        const decoded = Buffer.from(paddedValue, 'base64').toString('utf-8');
        const compareValue = caseSensitive ? decoded : decoded.toLowerCase();
        const comparePattern = caseSensitive ? pattern : pattern.toLowerCase();

        if (compareValue.includes(comparePattern)) {
          return true;
        }
      } catch {
        // Invalid base64 at this offset, try next
        continue;
      }
    }

    return false;
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
      // Invalid regex, no match
      console.warn(`[SigmaFieldMatcher] Invalid regex pattern: ${pattern}`, error);
      return false;
    }
  }

  /**
   * Match all words in any order
   */
  private static matchAllWords(
    value: string,
    pattern: string,
    caseSensitive: boolean
  ): boolean {
    const compareValue = caseSensitive ? value : value.toLowerCase();
    const words = (caseSensitive ? pattern : pattern.toLowerCase()).split(/\s+/);

    return words.every((word) => compareValue.includes(word));
  }

  /**
   * Match a Sigma selection block against log data
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
    // Empty selection matches nothing
    if (!selection || Object.keys(selection).length === 0) {
      return false;
    }

    // ALL fields must match (AND logic within a selection)
    return Object.entries(selection).every(([field, pattern]) => {
      // Parse field modifiers (e.g., "fieldname|contains", "fieldname|re")
      const { fieldName, modifier } = this.parseFieldWithModifier(field);

      // Get field value from log (support nested fields with dot notation)
      const fieldValue = this.getNestedField(logData, fieldName);

      // Handle |exists modifier specially
      if (modifier === 'exists') {
        const exists = fieldValue !== null && fieldValue !== undefined;
        // pattern should be true/false
        return pattern === true ? exists : !exists;
      }

      // Match with modifier
      return this.match(fieldValue, pattern, { caseSensitive, modifier });
    });
  }

  /**
   * Parse field name with optional modifier
   * Example: "CommandLine|contains" → { fieldName: "CommandLine", modifier: "contains" }
   */
  private static parseFieldWithModifier(field: string): {
    fieldName: string;
    modifier?: FieldModifier;
  } {
    const parts = field.split('|');

    if (parts.length === 1) {
      return { fieldName: parts[0] };
    }

    const fieldName = parts[0];
    const modifier = parts[1] as FieldModifier;

    return { fieldName, modifier };
  }

  /**
   * Get nested field value using dot notation
   * Example: "metadata.user.id" → logData.metadata.user.id
   */
  private static getNestedField(
    obj: Record<string, any>,
    path: string
  ): any {
    // Support both dot notation and direct access
    if (path in obj) {
      return obj[path];
    }

    // Try nested access
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
