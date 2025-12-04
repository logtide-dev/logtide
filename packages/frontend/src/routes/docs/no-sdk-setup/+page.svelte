<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { CheckCircle2, Info, Zap } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">No-SDK Setup</h1>
    <p class="text-lg text-muted-foreground mb-8">
        Use LogWard without installing any SDK. Just print to stdout - works
        with any language (Go, Rust, Python, Java, .NET, Ruby, PHP).
    </p>

    <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-8">
        <div class="flex items-start gap-3">
            <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
                <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    No SDK Required
                </p>
                <p class="text-sm text-muted-foreground">
                    LogWard supports <strong>stdout-based logging</strong> via Fluent
                    Bit (self-hosted) or Docker logging drivers (cloud). Simply write
                    to stdout/stderr and your logs will be automatically ingested.
                </p>
            </div>
        </div>
    </div>

    <h2
        id="choose-method"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Choose Your Method
    </h2>

    <div class="mb-8 grid md:grid-cols-2 gap-6">
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Cloud (api.logward.dev)</CardTitle>
            </CardHeader>
            <CardContent class="text-sm">
                <p class="text-muted-foreground mb-3">
                    Use Docker's Fluentd logging driver to send logs directly to
                    LogWard Cloud.
                </p>
                <ul class="space-y-2 ml-2">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>No Fluent Bit container needed</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Configure once in docker-compose.yml</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Zero code changes required</span>
                    </li>
                </ul>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">Self-Hosted</CardTitle>
            </CardHeader>
            <CardContent class="text-sm">
                <p class="text-muted-foreground mb-3">
                    LogWard includes Fluent Bit pre-configured to collect logs
                    from all Docker containers.
                </p>
                <ul class="space-y-2 ml-2">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Fluent Bit included in docker-compose</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Automatic metadata enrichment</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Full control over log processing</span>
                    </li>
                </ul>
            </CardContent>
        </Card>
    </div>

    <h2
        id="how-it-works"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        How It Works
    </h2>

    <div class="mb-8 space-y-4">
        <p>
            LogWard uses <strong>Fluent Bit</strong> to automatically collect logs
            from Docker containers:
        </p>

        <div class="grid gap-4">
            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <div
                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
                        >
                            <span class="text-primary font-semibold">1</span>
                        </div>
                        <div>
                            <CardTitle class="text-base"
                                >Your app writes to stdout/stderr</CardTitle
                            >
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Use standard console.log, print(), fmt.Println() - whatever
                    your language provides.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <div
                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
                        >
                            <span class="text-primary font-semibold">2</span>
                        </div>
                        <div>
                            <CardTitle class="text-base"
                                >Docker captures container output</CardTitle
                            >
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Docker's logging driver stores logs in JSON format at <code
                        >/var/lib/docker/containers/*/</code
                    >.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <div
                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
                        >
                            <span class="text-primary font-semibold">3</span>
                        </div>
                        <div>
                            <CardTitle class="text-base"
                                >Fluent Bit collects and enriches</CardTitle
                            >
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Fluent Bit tails container logs, adds metadata (container
                    name, service), and formats for LogWard.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <div
                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"
                        >
                            <span class="text-primary font-semibold">4</span>
                        </div>
                        <div>
                            <CardTitle class="text-base"
                                >Logs sent to LogWard API</CardTitle
                            >
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Fluent Bit sends logs to <code>/api/v1/ingest/single</code> with
                    your API key automatically.
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="setup-cloud"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Setup Instructions (Cloud)
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            For LogWard Cloud, configure your Docker containers to use the
            Fluentd logging driver:
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">
                1. Configure docker-compose.yml
            </h3>
            <p class="text-sm text-muted-foreground mb-3">
                Add logging configuration to each service in your
                <code>docker-compose.yml</code>:
            </p>
            <CodeBlock
                lang="yaml"
                code={`services:
  my-app:
    image: my-app:latest
    logging:
      driver: fluentd
      options:
        fluentd-address: api.logward.dev:24224
        fluentd-async: "true"
        tag: "lp_your_api_key_here.{{.Name}}"
        labels: "service"
    labels:
      service: "my-app"`}
            />
        </div>

        <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p
                        class="font-semibold text-blue-600 dark:text-blue-400 mb-1"
                    >
                        Coming Soon
                    </p>
                    <p class="text-sm text-muted-foreground">
                        LogWard Cloud is currently in beta. Sign up at
                        <a
                            href="/register"
                            class="text-primary underline">logward.dev</a
                        >
                        to get early access and we'll notify you when Fluentd logging
                        driver support is available.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="setup-selfhosted"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Setup Instructions (Self-Hosted)
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 class="text-lg font-semibold mb-3">1. Generate API Key</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Create an API key in your LogWard project settings.
            </p>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">
                2. Configure Fluent Bit API Key
            </h3>
            <p class="text-sm text-muted-foreground mb-3">
                Add your API key to the <code>docker/.env</code> file:
            </p>
            <CodeBlock
                lang="bash"
                code={`# In docker/.env
FLUENT_BIT_API_KEY=lp_your_api_key_here`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">3. Restart Fluent Bit</h3>
            <CodeBlock lang="bash" code={`docker compose restart fluent-bit`} />
        </div>

        <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <CheckCircle2
                    class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0"
                />
                <div>
                    <p
                        class="font-semibold text-green-600 dark:text-green-400 mb-1"
                    >
                        Setup Complete
                    </p>
                    <p class="text-sm text-muted-foreground">
                        All Docker containers now automatically send logs to
                        LogWard. No code changes needed!
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="examples"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Language Examples
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            Just write to stdout/stderr using your language's standard logging.
            No special library needed.
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">Go</h3>
            <CodeBlock
                lang="go"
                code={`package main

import (
    "log"
    "encoding/json"
)

func main() {
    // Simple text logging
    log.Println("Server started on port 8080")

    // Structured logging (JSON format recommended)
    logData := map[string]interface{}{
        "level":   "info",
        "message": "User logged in",
        "user_id": 12345,
        "ip":      "192.168.1.1",
    }
    json.NewEncoder(os.Stdout).Encode(logData)
}`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Rust</h3>
            <CodeBlock
                lang="rust"
                code={`use log::{info, error};
use env_logger;

fn main() {
    env_logger::init();

    info!("Application started");
    error!("Database connection failed");

    // Or use serde_json for structured logs
    println!("{}", serde_json::json!({
        "level": "info",
        "message": "Request processed",
        "duration_ms": 150
    }));
}`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Python</h3>
            <CodeBlock
                lang="python"
                code={`import logging
import json

# Standard logging
logging.basicConfig(level=logging.INFO)
logging.info("Application started")

# Structured JSON logging
log_data = {
    "level": "info",
    "message": "User action",
    "user_id": 12345,
    "action": "login"
}
print(json.dumps(log_data))`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Java</h3>
            <CodeBlock
                lang="java"
                code={`import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.databind.ObjectMapper;

public class App {
    private static final Logger logger = LoggerFactory.getLogger(App.class);

    public static void main(String[] args) {
        // Simple logging
        logger.info("Application started");

        // Structured logging (use Logback with JSON encoder)
        Map<String, Object> logData = new HashMap<>();
        logData.put("level", "info");
        logData.put("message", "Request received");
        logData.put("request_id", "abc123");

        System.out.println(new ObjectMapper().writeValueAsString(logData));
    }
}`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">.NET (C#)</h3>
            <CodeBlock
                lang="csharp"
                code={`using Serilog;
using System.Text.Json;

class Program
{
    static void Main()
    {
        // Using Serilog with console sink
        Log.Logger = new LoggerConfiguration()
            .WriteTo.Console(new JsonFormatter())
            .CreateLogger();

        Log.Information("Application started");
        Log.Error("Database connection failed", new { UserId = 123 });

        // Or manual JSON
        var logData = new {
            level = "info",
            message = "User login",
            user_id = 12345
        };
        Console.WriteLine(JsonSerializer.Serialize(logData));
    }
}`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">Ruby</h3>
            <CodeBlock
                lang="ruby"
                code={`require 'logger'
require 'json'

# Standard logging
logger = Logger.new(STDOUT)
logger.info("Application started")

# Structured JSON logging
log_data = {
  level: 'info',
  message: 'User action',
  user_id: 12345,
  action: 'login'
}
puts log_data.to_json`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">PHP</h3>
            <CodeBlock
                lang="php"
                code={`<?php
// Simple logging
error_log("Application started");

// Structured JSON logging
$logData = [
    'level' => 'info',
    'message' => 'User login',
    'user_id' => 12345,
    'ip' => $_SERVER['REMOTE_ADDR']
];
echo json_encode($logData) . "\\n";
?>`}
            />
        </div>
    </div>

    <h2
        id="docker-config"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Docker Configuration
    </h2>

    <div class="mb-8 space-y-6">
        <p>
            Fluent Bit is already configured in LogWard's <code
                >docker-compose.yml</code
            >:
        </p>

        <CodeBlock
            lang="yaml"
            code={`fluent-bit:
  image: fluent/fluent-bit:latest
  container_name: logward-fluent-bit
  volumes:
    - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
    - ./parsers.conf:/fluent-bit/etc/parsers.conf:ro
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
  environment:
    LOGWARD_API_KEY: \${FLUENT_BIT_API_KEY}
    LOGWARD_API_HOST: backend
  depends_on:
    - backend
  restart: unless-stopped`}
        />

        <Card>
            <CardHeader>
                <CardTitle class="flex items-center gap-2">
                    <Zap class="w-5 h-5 text-primary" />
                    What Fluent Bit Does
                </CardTitle>
            </CardHeader>
            <CardContent class="text-sm">
                <ul class="space-y-2 ml-2">
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span
                            >Tails logs from <code
                                >/var/lib/docker/containers/*/*.log</code
                            ></span
                        >
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span
                            >Parses Docker JSON logs and extracts metadata</span
                        >
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span
                            >Adds container name, ID, and image as metadata</span
                        >
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span
                            >Sends to LogWard API with automatic retries (3x)</span
                        >
                    </li>
                    <li class="flex items-start gap-2">
                        <CheckCircle2
                            class="w-4 h-4 text-primary mt-0.5 flex-shrink-0"
                        />
                        <span>Flushes logs every 5 seconds</span>
                    </li>
                </ul>
            </CardContent>
        </Card>
    </div>

    <h2
        id="fluent-bit-config"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Fluent Bit Configuration (Advanced)
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            If you want to customize Fluent Bit or use it outside of LogWard's
            Docker Compose setup, here's the complete configuration:
        </p>

        <div>
            <h3 class="text-lg font-semibold mb-3">fluent-bit.conf</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Main configuration file for Fluent Bit. This collects Docker
                container logs and sends them to LogWard:
            </p>
            <CodeBlock
                lang="conf"
                code={`# Fluent Bit Configuration for LogWard

[SERVICE]
    # Flush logs every 5 seconds
    Flush        5
    # Run in foreground
    Daemon       Off
    # Log level (error, warning, info, debug, trace)
    Log_Level    info
    # Parsers configuration file
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
# FILTER - Parse and Enrich
# =============================================================================
# Extract container metadata (name, id, image)
[FILTER]
    Name                parser
    Match               docker.*
    Key_Name            log
    Parser              docker_json
    Reserve_Data        On
    Preserve_Key        On

# Add required fields for LogWard API
[FILTER]
    Name                modify
    Match               docker.*
    # Set default level if not present
    Add                 level info
    # Rename 'log' field to 'message'
    Rename              log message
    # Set service name from container_name
    Copy                container_name service

# Remove unnecessary fields to reduce log size
[FILTER]
    Name                record_modifier
    Match               docker.*
    Remove_key          stream
    Remove_key          filepath
    Remove_key          container_name

# =============================================================================
# OUTPUT - Send to LogWard
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
    # Date/time settings
    Json_date_key       time
    Json_date_format    iso8601
    # Retry settings
    Retry_Limit         3
    # TLS (disable for internal Docker network)
    tls                 Off`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">parsers.conf</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Parser definitions for Docker JSON logs:
            </p>
            <CodeBlock
                lang="conf"
                code={`# Fluent Bit Parsers Configuration

# Parser for Docker JSON logs
[PARSER]
    Name        docker_json
    Format      json
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On

# Parser for Docker container logs
[PARSER]
    Name        docker
    Format      json
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">
                extract_container_id.lua (Optional)
            </h3>
            <p class="text-sm text-muted-foreground mb-3">
                Lua script to extract container ID from file path (used in
                LogWard's setup for metadata enrichment):
            </p>
            <CodeBlock
                lang="lua"
                code={`-- Extract container ID from Docker log file path
-- Path format: /var/lib/docker/containers/<container_id>/<container_id>-json.log

function extract_container_id(tag, timestamp, record)
    local filepath = record["filepath"]

    if filepath == nil then
        return 0, timestamp, record
    end

    -- Extract container ID from path
    -- Example: /var/lib/docker/containers/abc123.../abc123...-json.log
    local container_id = filepath:match("/var/lib/docker/containers/([^/]+)/")

    if container_id then
        record["container_id"] = container_id
        record["container_short_id"] = container_id:sub(1, 12)
    end

    -- Return code: 1 = modified and keep, 0 = no change
    return 1, timestamp, record
end`}
            />
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-3">
                Usage with docker-compose.yml
            </h3>
            <p class="text-sm text-muted-foreground mb-3">
                If you want to add Fluent Bit to your own project (not using
                LogWard's Docker Compose):
            </p>
            <CodeBlock
                lang="yaml"
                code={`services:
  fluent-bit:
    image: fluent/fluent-bit:latest
    container_name: my-fluent-bit
    volumes:
      # Mount configuration files
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf:ro
      - ./parsers.conf:/fluent-bit/etc/parsers.conf:ro
      # Optional: Lua scripts for advanced processing
      - ./extract_container_id.lua:/fluent-bit/etc/extract_container_id.lua:ro
      # Docker logs directory (read-only)
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      # Docker socket (read-only)
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      # For LogWard Cloud
      LOGWARD_API_KEY: lp_your_api_key_here
      LOGWARD_API_HOST: api.logward.dev

      # Or for self-hosted
      # LOGWARD_API_KEY: lp_your_api_key_here
      # LOGWARD_API_HOST: localhost  # or your server IP
    restart: unless-stopped
    networks:
      - your-network

networks:
  your-network:
    driver: bridge`}
            />
        </div>

        <div
            class="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4"
        >
            <div class="flex items-start gap-3">
                <Info class="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p
                        class="font-semibold text-yellow-600 dark:text-yellow-400 mb-1"
                    >
                        Important Notes
                    </p>
                    <ul class="text-sm text-muted-foreground space-y-1">
                        <li>
                            • Fluent Bit needs access to <code
                                >/var/lib/docker/containers</code
                            > to read container logs
                        </li>
                        <li>
                            • The <code>LOGWARD_API_KEY</code> environment
                            variable is used in the configuration via
                            <code>{"$"}{"{"}LOGWARD_API_KEY{"}"}</code>
                        </li>
                        <li>
                            • For cloud use, set <code
                                >LOGWARD_API_HOST=api.logward.dev</code
                            > and use HTTPS in the OUTPUT section
                        </li>
                        <li>
                            • Logs are batched and flushed every 5 seconds for
                            efficiency
                        </li>
                        <li>
                            • Failed sends are retried up to 3 times with
                            exponential backoff
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="when-to-use"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        SDK vs No-SDK: When to Use Each
    </h2>

    <div class="mb-8">
        <div class="grid md:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Use No-SDK When:</CardTitle>
                </CardHeader>
                <CardContent class="text-sm">
                    <ul class="space-y-2 ml-2">
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0"
                            />
                            <span>You want zero code changes (just deploy)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You're using multiple languages (Go, Rust,
                                Ruby, etc.)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You prefer centralized log collection (Fluent
                                Bit)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You're running in Docker/Kubernetes (stdout is
                                standard)</span
                            >
                        </li>
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Use SDK When:</CardTitle>
                </CardHeader>
                <CardContent class="text-sm">
                    <ul class="space-y-2 ml-2">
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You need advanced features (circuit breaker,
                                retries)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You want direct API control (batching,
                                buffering)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You're not using Docker (e.g., serverless, VMs)</span
                            >
                        </li>
                        <li class="flex items-start gap-2">
                            <CheckCircle2
                                class="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0"
                            />
                            <span
                                >You prefer programmatic logging (type-safe
                                APIs)</span
                            >
                        </li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    </div>

    <h2
        id="best-practices"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Best Practices
    </h2>

    <div class="mb-8 space-y-4">
        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >1. Use Structured Logging (JSON)</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p class="mb-2">
                    Instead of plain text, log in JSON format for better
                    parsing:
                </p>
                <CodeBlock
                    lang="json"
                    code={`{
  "level": "error",
  "message": "Payment failed",
  "user_id": 12345,
  "amount": 99.99,
  "error_code": "INSUFFICIENT_FUNDS"
}`}
                />
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base"
                    >2. Include Trace/Request IDs</CardTitle
                >
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    Add trace IDs to correlate logs across services (for
                    distributed tracing).
                </p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">3. Use Log Levels</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    Standardize levels: <code>debug</code>, <code>info</code>,
                    <code>warn</code>, <code>error</code>,
                    <code>critical</code>. Fluent Bit defaults to
                    <code>info</code> if not specified.
                </p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle class="text-base">4. Add Service Metadata</CardTitle>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    Fluent Bit automatically adds <code>container_name</code> as
                    <code>service</code>. Use descriptive container names in
                    <code>docker-compose.yml</code>.
                </p>
            </CardContent>
        </Card>
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
                Logs not appearing in LogWard?
            </h3>
            <ol class="list-decimal list-inside space-y-2 text-sm ml-4">
                <li>
                    Check Fluent Bit is running: <code
                        >docker compose ps fluent-bit</code
                    >
                </li>
                <li>
                    Check Fluent Bit logs: <code
                        >docker compose logs fluent-bit</code
                    >
                </li>
                <li>
                    Verify API key in <code>docker/.env</code>:
                    <code>FLUENT_BIT_API_KEY=lp_...</code>
                </li>
                <li>
                    Ensure your app is logging to stdout (not files): <code
                        >docker compose logs your-service</code
                    >
                </li>
                <li>
                    Check LogWard backend logs: <code
                        >docker compose logs backend | grep ingest</code
                    >
                </li>
            </ol>
        </div>

        <div>
            <h3 class="text-lg font-semibold mb-2">
                Logs have wrong service name?
            </h3>
            <p class="text-sm text-muted-foreground">
                Fluent Bit uses <code>container_name</code> from
                <code>docker-compose.yml</code>. Set descriptive names:
            </p>
            <CodeBlock
                lang="yaml"
                code={`services:
  my-app:
    container_name: my-app-production  # This becomes the service name
    image: my-app:latest`}
            />
        </div>
    </div>

    <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
        <div class="flex items-start gap-3">
            <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
                <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Collecting Syslog from Infrastructure?
                </p>
                <p class="text-sm text-muted-foreground">
                    Want to collect logs from Proxmox, ESXi, firewalls, or network devices?
                    Check out the <a href="/docs/syslog" class="text-primary underline">Syslog Integration</a> guide.
                </p>
            </div>
        </div>
    </div>

    <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <div class="flex items-start gap-3">
            <Info class="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
                <p class="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Next Steps
                </p>
                <p class="text-sm text-muted-foreground">
                    Want to explore SDKs for advanced features? Check out the
                    <a href="/docs/sdks" class="text-primary underline"
                        >SDK documentation</a
                    > for Node.js, Python, Go, PHP, and Kotlin.
                </p>
            </div>
        </div>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
