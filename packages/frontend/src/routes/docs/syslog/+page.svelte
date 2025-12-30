<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { CheckCircle2, Info, Server, Network } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Syslog Integration</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Collect logs from Proxmox, VMware ESXi, firewalls, routers, and any device
        that supports syslog. Perfect for home labs and infrastructure monitoring.
    </p>

    <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-8">
        <div class="flex items-start gap-3">
            <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
                <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Home Lab Ready
                </p>
                <p class="text-sm text-muted-foreground">
                    This guide is based on real-world configurations tested with Proxmox,
                    ESXi, UniFi, and various network devices. Works with both
                    <strong>RFC 3164</strong> (traditional) and <strong>RFC 5424</strong> (modern) syslog formats.
                </p>
            </div>
        </div>
    </div>

    <h2
        id="overview"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Overview
    </h2>

    <div class="mb-8 space-y-4">
        <p>
            LogWard can receive syslog messages via Fluent Bit, which acts as a
            syslog server listening on port 514 (UDP/TCP). This allows you to
            centralize logs from:
        </p>

        <div class="grid md:grid-cols-2 gap-4">
            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2 text-base">
                        <Server class="w-4 h-4 text-primary" />
                        Hypervisors & Servers
                    </CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• Proxmox VE</li>
                        <li>• VMware ESXi</li>
                        <li>• XCP-ng</li>
                        <li>• Linux servers (rsyslog/syslog-ng)</li>
                        <li>• TrueNAS / FreeNAS</li>
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-2 text-base">
                        <Network class="w-4 h-4 text-primary" />
                        Network Devices
                    </CardTitle>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    <ul class="space-y-1">
                        <li>• UniFi (UDM, switches, APs)</li>
                        <li>• pfSense / OPNsense</li>
                        <li>• MikroTik routers</li>
                        <li>• Cisco switches/routers</li>
                        <li>• Synology NAS</li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="fluent-bit-config"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Fluent Bit Configuration
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            Add syslog inputs to your Fluent Bit configuration. Create these files
            in your LogWard directory alongside docker-compose.yml.
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">fluent-bit.conf</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Complete configuration with Docker logs AND syslog support:
            </p>
            <CodeBlock
                lang="conf"
                code={`# Fluent Bit Configuration for LogWard
# Supports Docker container logs AND syslog from network devices

[SERVICE]
    Flush        5
    Daemon       Off
    Log_Level    info
    Parsers_File /fluent-bit/etc/parsers.conf

# =============================================================================
# INPUT - Docker Container Logs
# =============================================================================
[INPUT]
    Name              tail
    Path              /var/lib/docker/containers/*/*.log
    Parser            docker
    Tag               docker.*
    Refresh_Interval  5
    Mem_Buf_Limit     5MB
    Skip_Long_Lines   On
    Path_Key          filepath

# =============================================================================
# INPUT - Syslog (UDP) - Port 514
# =============================================================================
# Receive syslog messages on UDP (Proxmox, ESXi, firewalls, etc.)
[INPUT]
    Name        syslog
    Parser      syslog-rfc3164
    Listen      0.0.0.0
    Port        514
    Mode        udp
    Tag         syslog.udp

# =============================================================================
# INPUT - Syslog (TCP) - Port 514
# =============================================================================
# TCP is more reliable for important logs
[INPUT]
    Name        syslog
    Parser      syslog-rfc3164
    Listen      0.0.0.0
    Port        514
    Mode        tcp
    Tag         syslog.tcp

# =============================================================================
# FILTER - Docker Logs Processing
# =============================================================================
[FILTER]
    Name                parser
    Match               docker.*
    Key_Name            log
    Parser              docker_json
    Reserve_Data        On
    Preserve_Key        On

[FILTER]
    Name                lua
    Match               docker.*
    script              /fluent-bit/etc/extract_container_id.lua
    call                extract_container_id

[FILTER]
    Name                modify
    Match               docker.*
    Add                 level info
    Rename              log message
    Copy                container_name service

[FILTER]
    Name                record_modifier
    Match               docker.*
    Remove_key          stream
    Remove_key          filepath
    Remove_key          container_name

# =============================================================================
# FILTER - Syslog Processing
# =============================================================================
[FILTER]
    Name                modify
    Match               syslog.*
    Copy                ident service
    Add                 level info

# Map syslog severity to log level
[FILTER]
    Name                lua
    Match               syslog.*
    script              /fluent-bit/etc/map_syslog_level.lua
    call                map_syslog_level

[FILTER]
    Name                record_modifier
    Match               syslog.*
    Remove_key          pri
    Remove_key          ident
    Remove_key          pid

# =============================================================================
# OUTPUT - Send to LogWard API
# =============================================================================
[OUTPUT]
    Name                http
    Match               docker.*
    Host                \${LOGWARD_API_HOST}
    Port                8080
    URI                 /api/v1/ingest/single
    Format              json_lines
    Header              X-API-Key \${LOGWARD_API_KEY}
    Header              Content-Type application/json
    Json_date_key       time
    Json_date_format    iso8601
    Retry_Limit         3
    tls                 Off

[OUTPUT]
    Name                http
    Match               syslog.*
    Host                \${LOGWARD_API_HOST}
    Port                8080
    URI                 /api/v1/ingest/single
    Format              json_lines
    Header              X-API-Key \${LOGWARD_API_KEY}
    Header              Content-Type application/json
    Json_date_key       time
    Json_date_format    iso8601
    Retry_Limit         3
    tls                 Off`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">parsers.conf</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Parser definitions for Docker and both syslog formats:
            </p>
            <CodeBlock
                lang="conf"
                code={`# Fluent Bit Parsers Configuration

# =============================================================================
# PARSERS - Docker
# =============================================================================
[PARSER]
    Name        docker_json
    Format      json
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On

[PARSER]
    Name        docker
    Format      json
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On

# =============================================================================
# PARSERS - Syslog
# =============================================================================
# RFC 3164 - Traditional syslog format
# Used by: Proxmox, many Linux systems, older network devices
# IMPORTANT: RFC 3164 does NOT include timezone info in timestamps!
# Set Time_Offset to your local timezone offset (e.g., +0100 for CET, +0200 for CEST)
[PARSER]
    Name        syslog-rfc3164
    Format      regex
    Regex       /^\\<(?<pri>[0-9]+)\\>(?<time>[^ ]* {1,2}[^ ]* [^ ]*) (?<host>[^ ]*) (?<ident>[a-zA-Z0-9_\\/\\.\\-]*)(?:\\[(?<pid>[0-9]+)\\])?(?:[^\\:]*\\:)? *(?<message>.*)$/
    Time_Key    time
    Time_Format %b %d %H:%M:%S
    Time_Offset +0100
    Time_Keep   On

# RFC 5424 - Modern syslog format
# Used by: Modern Linux systems, VMware ESXi, some firewalls
[PARSER]
    Name        syslog-rfc5424
    Format      regex
    Regex       /^\\<(?<pri>[0-9]{1,5})\\>1 (?<time>[^ ]+) (?<host>[^ ]+) (?<ident>[^ ]+) (?<pid>[-0-9]+) (?<msgid>[^ ]+) (?<extradata>(\\[.*\\]|-)) (?<message>.+)$/
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">map_syslog_level.lua</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Lua script to convert syslog severity (0-7) to log levels.
                <strong>Note:</strong> LogWard automatically normalizes syslog levels server-side,
                so you can send levels like "notice", "emergency", "warning" etc. and they will be
                mapped to LogWard's 5 levels (debug, info, warn, error, critical).
            </p>
            <CodeBlock
                lang="lua"
                code={`-- Map syslog priority/severity to log level
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
end`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">extract_container_id.lua</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Lua script to extract container ID from Docker log paths:
            </p>
            <CodeBlock
                lang="lua"
                code={`-- Extract container ID from Docker log filepath
-- Path format: /var/lib/docker/containers/CONTAINER_ID/CONTAINER_ID-json.log

function extract_container_id(tag, timestamp, record)
    local filepath = record["filepath"]

    if filepath then
        local container_id = filepath:match("/var/lib/docker/containers/([^/]+)/")

        if container_id then
            record["container_id"] = container_id
            record["container_short_id"] = container_id:sub(1, 12)
        end
    end

    return 1, timestamp, record
end`}
            />
        </div>
    </div>

    <h2
        id="docker-compose"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Docker Compose Setup
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            Add Fluent Bit to your docker-compose.yml with syslog ports exposed:
        </p>

        <CodeBlock
            lang="yaml"
            code={`services:
  # ... your other services (postgres, redis, backend, frontend) ...

  fluent-bit:
    image: fluent/fluent-bit:4.2.2  # For ARM64: cr.fluentbit.io/fluent/fluent-bit:4.2.2
    container_name: logward-fluent-bit
    ports:
      - "514:514/udp"  # Syslog UDP
      - "514:514/tcp"  # Syslog TCP
    volumes:
      # Configuration files
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
      - ./parsers.conf:/fluent-bit/etc/parsers.conf:ro
      # Lua scripts
      - ./extract_container_id.lua:/fluent-bit/etc/extract_container_id.lua:ro
      - ./map_syslog_level.lua:/fluent-bit/etc/map_syslog_level.lua:ro
      # Docker logs access
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      LOGWARD_API_KEY: \${FLUENT_BIT_API_KEY}
      LOGWARD_API_HOST: backend
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped`}
        />

        <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <Info class="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p class="font-semibold text-yellow-600 dark:text-yellow-400 mb-1">
                        Port 514 Requires Root
                    </p>
                    <p class="text-sm text-muted-foreground">
                        Port 514 is a privileged port. If running Docker without root,
                        use a higher port (e.g., 5514) and configure your devices to
                        send to that port instead.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="proxmox"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Proxmox VE Setup
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            Configure Proxmox to send syslog messages to LogWard via rsyslog:
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">1. Install rsyslog (if not installed)</h3>
            <CodeBlock lang="bash" code={`apt install rsyslog -y`} />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">2. Create rsyslog configuration</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Create <code>/etc/rsyslog.d/50-logward.conf</code>:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Replace with your LogWard server IP
*.* @@10.0.0.100:514`}
            />
            <p class="text-sm text-muted-foreground mt-2">
                Use <code>@@</code> for TCP (recommended) or <code>@</code> for UDP.
            </p>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">3. Restart rsyslog</h3>
            <CodeBlock
                lang="bash"
                code={`systemctl restart rsyslog
systemctl status rsyslog`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">4. Test the connection</h3>
            <CodeBlock
                lang="bash"
                code={`logger -t proxmox-test "Test log from Proxmox to LogWard"`}
            />
            <p class="text-sm text-muted-foreground mt-2">
                Check LogWard - you should see the test message with service "proxmox-test".
            </p>
        </div>
    </div>

    <h2
        id="esxi"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        VMware ESXi Setup
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            Configure ESXi to forward syslog to LogWard:
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">Via Web UI (vSphere Client)</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>Navigate to <strong>Host → Manage → System → Advanced Settings</strong></li>
                <li>Find <code>Syslog.global.logHost</code></li>
                <li>Set value to: <code>udp://YOUR_LOGWARD_IP:514</code> or <code>tcp://YOUR_LOGWARD_IP:514</code></li>
                <li>Click Save</li>
            </ol>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Via SSH/CLI</h3>
            <CodeBlock
                lang="bash"
                code={`# Enable SSH on ESXi first, then:
esxcli system syslog config set --loghost='tcp://10.0.0.100:514'
esxcli system syslog reload`}
            />
        </div>

        <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                        ESXi Firewall
                    </p>
                    <p class="text-sm text-muted-foreground">
                        You may need to enable the syslog firewall rule:
                        <code>esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true</code>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="other-devices"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Other Devices
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 class="text-lg font-semibold mb-3">UniFi (UDM/USG)</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>Go to <strong>Settings → System → Remote Logging</strong></li>
                <li>Enable <strong>Remote Syslog Server</strong></li>
                <li>Enter your LogWard server IP and port 514</li>
                <li>Select log level (Info recommended)</li>
            </ol>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">pfSense / OPNsense</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>Go to <strong>Status → System Logs → Settings</strong></li>
                <li>Check <strong>Enable Remote Logging</strong></li>
                <li>Enter your LogWard server IP in <strong>Remote log servers</strong></li>
                <li>Select which logs to send (firewall, system, etc.)</li>
            </ol>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Linux Servers (rsyslog)</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Same as Proxmox - create <code>/etc/rsyslog.d/50-logward.conf</code>:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Forward all logs to LogWard (TCP)
*.* @@YOUR_LOGWARD_IP:514

# Or forward only specific facilities/severities:
# auth,authpriv.* @@YOUR_LOGWARD_IP:514    # Auth logs only
# *.err @@YOUR_LOGWARD_IP:514              # Errors and above only`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Synology NAS</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>Go to <strong>Control Panel → Log Center → Log Sending</strong></li>
                <li>Check <strong>Send logs to a syslog server</strong></li>
                <li>Enter your LogWard server IP</li>
                <li>Select format: BSD (RFC 3164) or IETF (RFC 5424)</li>
            </ol>
        </div>
    </div>

    <h2
        id="rsyslog-http"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Rsyslog HTTP Forwarding (Advanced)
    </h2>

    <div class="mb-8 space-y-6">
        <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <Info class="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p class="font-semibold text-yellow-600 dark:text-yellow-400 mb-1">
                        Known Limitation: omhttp Module
                    </p>
                    <p class="text-sm text-muted-foreground">
                        The rsyslog <code>omhttp</code> module (for sending logs directly via HTTP)
                        is <strong>not available in default rsyslog packages</strong> on many distributions,
                        including Debian 13 (Trixie), Ubuntu, and some RHEL-based systems. This is a
                        known upstream limitation, not a LogWard issue.
                    </p>
                </div>
            </div>
        </div>

        <p class="text-muted-foreground">
            If you need to send syslog messages directly to LogWard's HTTP API without using
            Fluent Bit's syslog input, you have several options:
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">Option 1: Use Fluent Bit (Recommended)</h3>
            <p class="text-sm text-muted-foreground mb-3">
                The simplest solution is to use Fluent Bit as described in this guide. Fluent Bit
                receives syslog messages on port 514 and forwards them to LogWard's HTTP API.
                This is the recommended approach.
            </p>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Option 2: Vector as HTTP Bridge</h3>
            <p class="text-sm text-muted-foreground mb-3">
                <a href="https://vector.dev" target="_blank" rel="noopener noreferrer" class="text-primary underline">Vector</a>
                is a high-performance observability data pipeline that can act as a syslog-to-HTTP bridge:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Install Vector (Debian/Ubuntu)
curl --proto '=https' --tlsv1.2 -sSf https://sh.vector.dev | bash

# Or via apt
curl -1sLf 'https://repositories.timber.io/public/vector/cfg/setup/bash.deb.sh' | sudo bash
sudo apt install vector`}
            />
            <p class="text-sm text-muted-foreground my-3">
                Create <code>/etc/vector/vector.toml</code>:
            </p>
            <CodeBlock
                lang="toml"
                code={`# Vector configuration for rsyslog → LogWard

[sources.rsyslog]
type = "syslog"
address = "0.0.0.0:514"
mode = "tcp"  # or "udp"

[transforms.format_logs]
type = "remap"
inputs = ["rsyslog"]
source = '''
# Transform syslog fields to LogWard format
.message = string!(.message)
.level = downcase(string(.severity) ?? "info")
.service = string(.appname) ?? string(.hostname) ?? "syslog"
.time = now()

# Add metadata
.metadata = {}
.metadata.hostname = string(.hostname) ?? null
.metadata.facility = string(.facility) ?? null
.metadata.procid = string(.procid) ?? null

# Remove original syslog fields
del(.severity)
del(.appname)
del(.hostname)
del(.facility)
del(.procid)
'''

[sinks.logward]
type = "http"
inputs = ["format_logs"]
uri = "http://YOUR_LOGWARD_HOST:8080/api/v1/ingest/single"
encoding.codec = "json"

[sinks.logward.request]
headers.X-API-Key = "lp_your_api_key_here"
headers.Content-Type = "application/json"`}
            />
            <CodeBlock
                lang="bash"
                code={`# Start Vector
sudo systemctl enable vector
sudo systemctl start vector

# Check status
sudo systemctl status vector
vector --version`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Option 3: Build rsyslog with omhttp</h3>
            <p class="text-sm text-muted-foreground mb-3">
                If you need native rsyslog HTTP support, you can compile rsyslog from source
                with the omhttp module enabled. This requires development libraries and is
                more complex to maintain:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Install build dependencies (Debian/Ubuntu)
sudo apt install build-essential pkg-config libestr-dev libfastjson-dev \\
  zlib1g-dev libcurl4-openssl-dev uuid-dev libgcrypt20-dev

# Download and compile rsyslog
wget https://www.rsyslog.com/files/download/rsyslog/rsyslog-8.2312.0.tar.gz
tar xzf rsyslog-8.2312.0.tar.gz
cd rsyslog-8.2312.0

./configure --enable-omhttp
make
sudo make install`}
            />
            <p class="text-xs text-muted-foreground mt-2">
                Note: Building from source means you're responsible for security updates
                and compatibility. The Fluent Bit or Vector approaches are generally preferred.
            </p>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Option 4: Use omfwd + Local HTTP Forwarder</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Forward syslog to a local Fluent Bit or Vector instance using standard
                rsyslog forwarding (<code>omfwd</code>), then let that service handle HTTP:
            </p>
            <CodeBlock
                lang="bash"
                code={`# /etc/rsyslog.d/50-logward.conf
# Forward all logs to local Fluent Bit syslog input
*.* @@127.0.0.1:5514`}
            />
            <p class="text-xs text-muted-foreground mt-2">
                This keeps your rsyslog configuration simple and delegates HTTP
                complexity to a dedicated tool.
            </p>
        </div>
    </div>

    <h2
        id="troubleshooting"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Troubleshooting
    </h2>

    <div class="mb-8 space-y-4">
        <div>
            <h3 class="text-lg font-semibold mb-2">
                Syslog messages not appearing?
            </h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>
                    Verify Fluent Bit is running: <code>docker compose ps fluent-bit</code>
                </li>
                <li>
                    Check Fluent Bit logs: <code>docker compose logs fluent-bit</code>
                </li>
                <li>
                    Test connectivity from source: <code>nc -zv YOUR_LOGWARD_IP 514</code>
                </li>
                <li>
                    Check firewall allows port 514 (TCP/UDP)
                </li>
                <li>
                    Verify API key is set in <code>.env</code>: <code>FLUENT_BIT_API_KEY=lp_...</code>
                </li>
            </ol>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-2">
                Test syslog manually
            </h3>
            <p class="text-sm text-muted-foreground mb-2">
                Send a test syslog message using netcat:
            </p>
            <CodeBlock
                lang="bash"
                code={`# UDP test
echo "<14>Test syslog message from terminal" | nc -u -w1 YOUR_LOGWARD_IP 514

# TCP test
echo "<14>Test syslog message from terminal" | nc -w1 YOUR_LOGWARD_IP 514`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-2">
                Service name shows as "syslog"?
            </h3>
            <p class="text-sm text-muted-foreground">
                The service name comes from the syslog "ident" field (program name).
                If your device doesn't send an ident, the hostname will be used.
                You can customize the Lua script to set service names based on hostname patterns.
            </p>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-2">
                RFC 3164 timestamps are wrong (off by hours)?
            </h3>
            <p class="text-sm text-muted-foreground mb-2">
                RFC 3164 syslog format does NOT include timezone information in timestamps.
                If your logs show incorrect times, set the <code>SYSLOG_TZ_OFFSET</code>
                environment variable on your Fluent Bit container.
            </p>
            <p class="text-sm text-muted-foreground mb-2">
                <strong>Quick fix:</strong> Add this to your <code>docker-compose.yml</code>:
            </p>
            <CodeBlock
                lang="yaml"
                code={`services:
  fluent-bit:
    environment:
      - SYSLOG_TZ_OFFSET=1    # CET (Central European Time)
      # - SYSLOG_TZ_OFFSET=2  # CEST (Summer time)
      # - SYSLOG_TZ_OFFSET=-5 # EST (Eastern Standard Time)`}
            />
            <p class="text-sm text-muted-foreground mt-2 mb-2">
                <strong>Alternative:</strong> You can also set <code>Time_Offset</code> directly
                in the parser configuration (<code>parsers.conf</code>):
            </p>
            <CodeBlock
                lang="conf"
                code={`[PARSER]
    Name        syslog-rfc3164
    ...
    Time_Format %b %d %H:%M:%S
    Time_Offset +0100    # For CET
    Time_Keep   On`}
            />
            <p class="text-sm text-muted-foreground mt-2">
                <strong>Note:</strong> RFC 5424 includes timezone in the timestamp
                (e.g., <code>2025-12-23T16:51:02+01:00</code>) and doesn't need this fix.
                Consider configuring your devices to use RFC 5424 format if possible.
            </p>
        </div>
    </div>

    <h2
        id="sigma-rules"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Security Detection with Sigma Rules
    </h2>

    <div class="mb-8 space-y-4">
        <p class="text-muted-foreground">
            Once syslog is flowing into LogWard, you can use Sigma rules to detect
            security threats. LogWard supports the industry-standard Sigma format
            for log detection rules.
        </p>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Example: Detect SSH Brute Force</CardTitle>
            </CardHeader>
            <CardContent>
                <CodeBlock
                    lang="yaml"
                    code={`title: SSH Authentication Failure
status: stable
logsource:
    product: linux
    service: sshd
detection:
    selection:
        message|contains:
            - 'Failed password'
            - 'authentication failure'
    condition: selection
level: medium`}
                />
            </CardContent>
        </Card>

        <p class="text-sm text-muted-foreground">
            Learn more about Sigma rules in the
            <a href="/docs/api#sigma" class="text-primary underline">API documentation</a>.
        </p>
    </div>

    <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4 mb-8">
        <div class="flex items-start gap-3">
            <CheckCircle2 class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <div>
                <p class="font-semibold text-green-600 dark:text-green-400 mb-1">
                    You're All Set!
                </p>
                <p class="text-sm text-muted-foreground">
                    Your infrastructure logs are now flowing into LogWard. Use the
                    search and filter features to explore your logs, set up alerts
                    for important events, and enable Sigma rules for security monitoring.
                </p>
            </div>
        </div>
    </div>

    <div class="border-t border-border pt-6 mt-8">
        <p class="text-sm text-muted-foreground">
            This guide was inspired by Brandon Lee's excellent article
            <a
                href="https://www.virtualizationhowto.com/2025/12/logward-is-the-lightweight-syslog-server-every-home-lab-needs-in-2025/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:underline"
            >"LogWard Is the Lightweight Syslog Server Every Home Lab Needs in 2025"</a>
            on VirtualizationHowto.
        </p>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
