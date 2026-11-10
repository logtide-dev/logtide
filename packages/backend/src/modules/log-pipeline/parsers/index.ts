import type { ParserStep } from '../types.js';
import { parseNginx } from './nginx.js';
import { parseApache } from './apache.js';
import { parseSyslog } from './syslog.js';
import { parseLogfmt } from './logfmt.js';
import { parseOdoo } from './odoo.js';
import { parseJsonMessage } from './json-message.js';

export function runBuiltinParser(
  step: ParserStep,
  message: string
): Record<string, unknown> | null {
  switch (step.parser) {
    case 'nginx':   return parseNginx(message);
    case 'apache':  return parseApache(message);
    case 'syslog':  return parseSyslog(message);
    case 'logfmt':  return parseLogfmt(message);
    case 'odoo':    return parseOdoo(message);
    case 'json':    return parseJsonMessage(message);
    default:        return null;
  }
}
