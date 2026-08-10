/**
 * Outbound payload formatters.
 *
 * Some destinations refuse the LogTide event envelope and expect their own
 * body shape. A formatter claims a destination and rewrites the body right
 * before serialization; unclaimed destinations keep receiving the envelope.
 */
export interface OutboundFormatter {
  /** Formatter name, used in logs and tests. */
  readonly name: string;
  /** True when this formatter owns the destination. */
  matches(url: URL): boolean;
  /** Rewrite the body. Must never throw. */
  format(body: unknown): unknown;
}
