/**
 * Exception Module
 *
 * Provides exception tracking and error grouping functionality:
 * - Stack trace parsing for multiple languages (Node.js, Python, Java, Go, PHP)
 * - Fingerprint-based error grouping (like Sentry)
 * - Exception storage and retrieval
 * - Error group management (status, trends, logs)
 */

export { ExceptionService } from './service.js';
export { FingerprintService } from './fingerprint-service.js';
export { ParserFactory } from './parsers/parser-factory.js';
export { exceptionsRoutes } from './routes.js';
export * from './types.js';
