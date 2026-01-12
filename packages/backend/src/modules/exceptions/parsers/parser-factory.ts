/**
 * Parser Factory
 *
 * Detects the programming language from a log message and returns
 * the appropriate parser. Tries each parser in order of likelihood.
 */

import type { BaseExceptionParser } from './base-parser.js';
import { NodeJSExceptionParser } from './nodejs-parser.js';
import { PythonExceptionParser } from './python-parser.js';
import { JavaExceptionParser } from './java-parser.js';
import { GoExceptionParser } from './go-parser.js';
import { PHPExceptionParser } from './php-parser.js';
import type { ExceptionLanguage, ParsedException } from '../types.js';

const parsers: BaseExceptionParser[] = [
  new NodeJSExceptionParser(),
  new PythonExceptionParser(),
  new JavaExceptionParser(),
  new GoExceptionParser(),
  new PHPExceptionParser(),
];

export class ParserFactory {
  /**
   * Detect which parser can handle this message and return it
   * Returns null if no parser can handle the message
   */
  static detectParser(message: string): BaseExceptionParser | null {
    if (!message) return null;

    for (const parser of parsers) {
      if (parser.canParse(message)) {
        return parser;
      }
    }

    return null;
  }

  /**
   * Detect language from a log message without parsing
   */
  static detectLanguage(message: string): ExceptionLanguage | null {
    const parser = this.detectParser(message);
    return parser?.language || null;
  }

  /**
   * Parse a message and return the parsed exception
   * Automatically detects the language
   */
  static parse(message: string): ParsedException | null {
    const parser = this.detectParser(message);
    if (!parser) return null;
    return parser.parse(message);
  }

  /**
   * Parse with a specific language parser
   */
  static parseWithLanguage(
    message: string,
    language: ExceptionLanguage
  ): ParsedException | null {
    const parser = parsers.find((p) => p.language === language);
    if (!parser) return null;
    return parser.parse(message);
  }

  /**
   * Get the parser instance for a specific language
   */
  static getParser(language: ExceptionLanguage): BaseExceptionParser | null {
    return parsers.find((p) => p.language === language) || null;
  }

  /**
   * Get all supported languages
   */
  static getSupportedLanguages(): ExceptionLanguage[] {
    return parsers.map((p) => p.language);
  }
}
