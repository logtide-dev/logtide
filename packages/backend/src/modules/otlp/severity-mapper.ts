/**
 * OTLP Severity Mapper
 *
 * Maps OpenTelemetry SeverityNumber (0-24) to LogTide log levels.
 *
 * OpenTelemetry Severity Levels:
 * - 0: UNSPECIFIED
 * - 1-4: TRACE, TRACE2, TRACE3, TRACE4
 * - 5-8: DEBUG, DEBUG2, DEBUG3, DEBUG4
 * - 9-12: INFO, INFO2, INFO3, INFO4
 * - 13-16: WARN, WARN2, WARN3, WARN4
 * - 17-20: ERROR, ERROR2, ERROR3, ERROR4
 * - 21-24: FATAL, FATAL2, FATAL3, FATAL4
 *
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */

export type LogTideLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * Maps OpenTelemetry SeverityNumber to LogTide level.
 *
 * @param severityNumber - OTLP severity number (0-24)
 * @param severityText - Optional severity text (e.g., "ERROR", "WARN")
 * @returns LogTide log level
 */
export function mapSeverityToLevel(
  severityNumber?: number,
  severityText?: string
): LogTideLevel {
  // Try severityText first if provided (allows custom SDK severity names)
  if (severityText) {
    const normalized = severityText.toLowerCase();

    if (normalized.includes('trace')) return 'debug';
    if (normalized.includes('debug')) return 'debug';
    if (normalized.includes('info')) return 'info';
    if (normalized.includes('warn')) return 'warn';
    if (normalized.includes('error')) return 'error';
    if (normalized.includes('fatal') || normalized.includes('critical')) return 'critical';
  }

  // Map by severity number
  const num = severityNumber ?? 0;

  // FATAL (21-24) -> critical
  if (num >= 21) return 'critical';

  // ERROR (17-20) -> error
  if (num >= 17) return 'error';

  // WARN (13-16) -> warn
  if (num >= 13) return 'warn';

  // INFO (9-12) -> info
  if (num >= 9) return 'info';

  // TRACE (1-4) and DEBUG (5-8) -> debug
  if (num >= 1) return 'debug';

  // UNSPECIFIED (0) -> info (default)
  return 'info';
}

/**
 * Reverse mapping: LogTide level to OTLP SeverityNumber.
 * Useful for testing or exporting logs.
 *
 * @param level - LogTide log level
 * @returns OTLP severity number
 */
export function levelToSeverityNumber(level: LogTideLevel): number {
  switch (level) {
    case 'debug':
      return 5; // DEBUG
    case 'info':
      return 9; // INFO
    case 'warn':
      return 13; // WARN
    case 'error':
      return 17; // ERROR
    case 'critical':
      return 21; // FATAL
    default:
      return 9; // INFO as default
  }
}
