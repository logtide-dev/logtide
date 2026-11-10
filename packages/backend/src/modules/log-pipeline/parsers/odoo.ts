// Odoo default log format (odoo/netsvc.py):
// %(asctime)s %(pid)s %(levelname)s %(dbname)s %(name)s: %(message)s %(perf_info)s
//
// Only the first line of a record matches. Multi-line tracebacks arrive as
// continuation lines that do not start with a timestamp and return null here;
// joining them into the first line is the shipper's job (e.g. a Fluent Bit
// multiline parser), not the pipeline's.
const ODOO_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) (\d+) (DEBUG|INFO|WARNING|ERROR|CRITICAL) (\S+) ([^\s:]+): (.*)$/s;

// "client - - [dd/Mon/yyyy HH:MM:SS] "METHOD /path HTTP/x.y" status size [queries query_time remaining_time]"
const WERKZEUG_REGEX = /^(\S+) \S+ \S+ \[[^\]]*\] "(\S+) (\S+) HTTP\/([\d.]+)" (\d{3})(?: (\S+))?(?: (\S+) (\S+) (\S+))?\s*$/;

// Odoo colorizes status and perf numbers with ANSI escapes when logging to a tty
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

const LEVEL_MAP: Record<string, string> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'critical',
};

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return parseInt(value, 10);
}

function toFloat(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return undefined;
  return parseFloat(value);
}

export function parseOdoo(message: string): Record<string, unknown> | null {
  const m = ODOO_REGEX.exec(message.replace(ANSI_REGEX, '').trim());
  if (!m) return null;

  const [, timestamp, pid, levelName, dbname, logger, text] = m;

  const result: Record<string, unknown> = {
    timestamp,
    pid: parseInt(pid, 10),
    level: LEVEL_MAP[levelName],
    odoo_level: levelName,
    ...(dbname !== '?' ? { dbname } : {}),
    logger,
    message: text,
  };

  if (logger === 'werkzeug') {
    const w = WERKZEUG_REGEX.exec(text);
    if (w) {
      const [, clientIp, method, rawPath, version, status, size, queries, queryTime, remainingTime] = w;
      const [path, query] = rawPath.split('?');
      const queryCount = toInt(queries);
      const qt = toFloat(queryTime);
      const rt = toFloat(remainingTime);
      const responseBytes = toInt(size);

      result.client_ip = clientIp;
      result.http_method = method;
      result.http_path = path;
      if (query) result.http_query = query;
      result.http_version = version;
      result.http_status = parseInt(status, 10);
      if (responseBytes !== undefined) result.response_bytes = responseBytes;
      if (queryCount !== undefined) result.query_count = queryCount;
      if (qt !== undefined) result.query_time = qt;
      if (rt !== undefined) result.remaining_time = rt;
      if (qt !== undefined && rt !== undefined) {
        result.duration_ms = Math.round((qt + rt) * 1000);
      }
    }
  }

  return result;
}
