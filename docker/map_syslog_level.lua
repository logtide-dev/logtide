-- Map syslog priority/severity to log level
-- Syslog severity levels (from RFC 3164/5424):
-- 0 = Emergency, 1 = Alert, 2 = Critical, 3 = Error
-- 4 = Warning, 5 = Notice, 6 = Informational, 7 = Debug
--
-- LogWard automatically maps these to its 5 levels:
-- emergency/alert/critical -> critical
-- error -> error
-- warning -> warn
-- notice/info -> info
-- debug -> debug
--
-- TIMEZONE FIX for RFC 3164:
-- RFC 3164 timestamps don't include timezone info.
-- Set SYSLOG_TZ_OFFSET env var to your timezone offset in hours.
-- Examples: SYSLOG_TZ_OFFSET=1 (CET), SYSLOG_TZ_OFFSET=2 (CEST), SYSLOG_TZ_OFFSET=-5 (EST)

-- Read timezone offset from environment (in hours, e.g., 1 for CET, 2 for CEST)
local tz_offset_hours = tonumber(os.getenv("SYSLOG_TZ_OFFSET")) or 0
local tz_offset_seconds = tz_offset_hours * 3600

function map_syslog_level(tag, timestamp, record)
    local pri = tonumber(record["pri"])

    if pri then
        -- Extract severity from priority (severity = pri % 8)
        local severity = pri % 8

        -- Map severity number to log level string
        -- LogWard will normalize these to its 5 levels
        local level_map = {
            [0] = "emergency",
            [1] = "alert",
            [2] = "critical",
            [3] = "error",
            [4] = "warning",
            [5] = "notice",
            [6] = "info",
            [7] = "debug"
        }

        record["level"] = level_map[severity] or "info"
    else
        record["level"] = "info"
    end

    -- Apply timezone offset for RFC 3164 (which lacks timezone info)
    -- The offset converts local time to UTC
    local adjusted_timestamp = timestamp - tz_offset_seconds

    -- Set 'time' field in ISO8601 format (UTC)
    record["time"] = os.date("!%Y-%m-%dT%H:%M:%SZ", adjusted_timestamp)

    -- Keep hostname from syslog
    if record["host"] and record["host"] ~= "-" then
        record["hostname"] = record["host"]
    end

    -- Use ident (program name) as service if available
    if not record["service"] and record["ident"] and record["ident"] ~= "-" then
        record["service"] = record["ident"]
    elseif not record["service"] and record["hostname"] then
        record["service"] = record["hostname"]
    else
        record["service"] = "syslog"
    end

    -- Clean up fields
    record["pri"] = nil
    record["ident"] = nil
    record["host"] = nil

    return 1, adjusted_timestamp, record
end
