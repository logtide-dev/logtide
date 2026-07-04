-- Extract container ID and name from Docker log filepath
-- Path format: /var/lib/docker/containers/CONTAINER_ID/CONTAINER_ID-json.log
-- The container name is not part of the path, so it is read from the
-- config.v2.json file that Docker keeps next to the log file.

-- Cache of container_id -> container name (or false when not resolvable),
-- so config.v2.json is read once per container, not once per record.
local name_cache = {}

local function lookup_container_name(container_id)
    local cached = name_cache[container_id]
    if cached ~= nil then
        return cached or nil
    end

    local name = nil
    local path = "/var/lib/docker/containers/" .. container_id .. "/config.v2.json"
    local file = io.open(path, "r")
    if file then
        local content = file:read("*a")
        file:close()
        if content then
            -- Container names always start with "/" in config.v2.json
            -- (volume mounts also have "Name" keys, but without the slash)
            name = content:match('"Name"%s*:%s*"/([^"]+)"')
        end
    end

    name_cache[container_id] = name or false
    return name
end

function extract_container_id(tag, timestamp, record)
    -- Get the filepath from the record
    local filepath = record["filepath"]

    if filepath then
        -- Extract container ID from path
        -- Pattern: /var/lib/docker/containers/CONTAINER_ID/...
        local container_id = filepath:match("/var/lib/docker/containers/([^/]+)/")

        if container_id then
            -- Add container_id to the record
            record["container_id"] = container_id
            -- Add short ID (first 12 chars, like docker ps shows)
            record["container_short_id"] = container_id:sub(1, 12)
            -- Resolve the container name; fall back to the short ID so the
            -- downstream "Copy container_name service" filter always works
            record["container_name"] = lookup_container_name(container_id)
                or record["container_short_id"]
        end
    end

    -- Return modified record
    -- Return code: -1 (drop), 0 (keep), 1 (modified)
    return 1, timestamp, record
end
