-- Wrap logs for LogTide API format
-- LogTide expects: { "logs": [ {...}, {...} ] }

function wrap_logs(tag, timestamp, record)
    -- Extract fields from the log record
    local wrapped = {
        logs = {
            {
                time = os.date("!%Y-%m-%dT%H:%M:%SZ", timestamp),
                service = record["container_name"] or record["container_short_id"] or "unknown",
                level = "info",  -- Default level, can be parsed from log message
                message = record["log"] or tostring(record),
                metadata = {
                    container_id = record["container_id"],
                    container_short_id = record["container_short_id"],
                    source = "fluent-bit"
                }
            }
        }
    }

    -- Return the wrapped structure
    -- Return code: 1 = modified and keep
    return 1, timestamp, wrapped
end
