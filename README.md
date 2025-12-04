<div align="center">
  <br />
  <img src="docs/images/logo.png" alt="🛡️ LogWard" width="auto" height="120" />
  <p>
    <strong>Privacy-first log management. Open Source.</strong>
  </p>

  <p>
    <a href="https://logward.dev"><strong>☁️ Try Cloud (Free Alpha)</strong></a> •
    <a href="#self-hosting">Self-Host</a> •
    <a href="#sdks--integrations">SDKs</a> •
    <a href="https://logward.dev/docs">Docs</a>
  </p>

  <a href="https://github.com/logward-dev/logward/actions/workflows/ci.yml"><img src="https://github.com/logward-dev/logward/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/logward-dev/logward"><img src="https://codecov.io/gh/logward-dev/logward/branch/main/graph/badge.svg" alt="Coverage"></a>
  <a href="https://hub.docker.com/r/logward/backend"><img src="https://img.shields.io/docker/v/logward/backend?label=docker&logo=docker" alt="Docker"></a>
  <img src="https://img.shields.io/badge/version-0.2.4-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/license-AGPLv3-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Status">
  <img src="https://img.shields.io/badge/cloud-free_during_alpha-success.svg" alt="Free Cloud">
  <img src="https://img.shields.io/badge/stack-SvelteKit_5_|_TimescaleDB-6366f1.svg" alt="Tech Stack">
</div>

<br />

> **⚠️ ALPHA RELEASE:** LogWard is currently in active Alpha.
> The Cloud version is **100% FREE** for early adopters. We are looking for feedback to improve stability!

---

## 👋 What is LogWard?

LogWard is an open-source alternative to Datadog, Splunk, and ELK.
Designed for developers and European SMBs who need **GDPR compliance**, **data ownership**, and **simplicity** without the complexity of managing an ElasticSearch cluster.

### Why LogWard?
* 🇪🇺 **GDPR Friendly:** Keep data on your servers or use our EU-based cloud.
* ⚡ **Lightweight:** Built on **TimescaleDB** & **Fastify** (low RAM usage compared to Java stacks).
* 🚀 **Developer Experience:** 5-minute setup with Docker. Native SDKs.
* 💰 **Cost Effective:** Self-host for free.

---

## 📸 Screenshots

### Logs Explorer
![LogWard Logs](docs/images/logs.png)

### Distributed Tracing
![LogWard Traces](docs/images/traces.png)

### Alerts & Notifications
![LogWard Alerts](docs/images/alerts.png)

---

## 🚀 Quick Start

Choose how you want to use LogWard.

### Option A: Cloud (Fastest & Free)
We host it for you. Perfect for testing and small projects. **Currently Free.**

1.  **Sign up:** Go to [**logward.dev**](https://logward.dev).
2.  **Create Project:** Create an organization and a project.
3.  **Get API Key:** Copy your project-scoped API Key.
4.  **Send a Log:**
    ```bash
    curl -X POST https://api.logward.dev/api/v1/ingest \
      -H "X-API-Key: YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{ "logs": [{ "service": "test", "level": "info", "message": "Hello Cloud!" }] }'
    ```

### Option B: Self-Hosted (Docker)
Total control over your data. **No build required** - uses pre-built images from Docker Hub.

**Prerequisites:** Docker & Docker Compose.

1.  **Create `docker-compose.yml`**
    ```yaml
    services:
      postgres:
        image: timescale/timescaledb:latest-pg16
        environment:
          POSTGRES_DB: logward
          POSTGRES_USER: logward
          POSTGRES_PASSWORD: ${DB_PASSWORD:-password}
        volumes:
          - postgres_data:/var/lib/postgresql/data
        healthcheck:
          test: ["CMD-SHELL", "pg_isready -U logward"]
          interval: 10s
          timeout: 5s
          retries: 5

      redis:
        image: redis:7-alpine
        command: redis-server --requirepass ${REDIS_PASSWORD:-password}
        volumes:
          - redis_data:/data
        healthcheck:
          test: ["CMD", "sh", "-c", "redis-cli -a ${REDIS_PASSWORD:-password} ping | grep -q PONG"]
          interval: 10s
          timeout: 3s
          retries: 5

      backend:
        image: logward/backend:latest
        ports:
          - "8080:8080"
        environment:
          DATABASE_URL: postgresql://logward:${DB_PASSWORD:-password}@postgres:5432/logward
          DATABASE_HOST: postgres
          DB_USER: logward
          REDIS_URL: redis://:${REDIS_PASSWORD:-password}@redis:6379
          API_KEY_SECRET: ${API_KEY_SECRET:-change_me_32_chars_secret_key!!}
        depends_on:
          postgres:
            condition: service_healthy
          redis:
            condition: service_healthy
        healthcheck:
          test: ["CMD", "node", "-e", "require('http').get('http://localhost:8080/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1))"]
          interval: 30s
          timeout: 3s
          retries: 3
          start_period: 40s

      worker:
        image: logward/backend:latest
        command: ["worker"]
        environment:
          DATABASE_URL: postgresql://logward:${DB_PASSWORD:-password}@postgres:5432/logward
          DATABASE_HOST: postgres
          DB_USER: logward
          REDIS_URL: redis://:${REDIS_PASSWORD:-password}@redis:6379
          API_KEY_SECRET: ${API_KEY_SECRET:-change_me_32_chars_secret_key!!}
        depends_on:
          backend:
            condition: service_healthy
          redis:
            condition: service_healthy

      frontend:
        image: logward/frontend:latest
        ports:
          - "3000:3000"
        environment:
          PUBLIC_API_URL: http://localhost:8080
        depends_on:
          - backend

    volumes:
      postgres_data:
      redis_data:
    ```

    > **Note:** Database migrations run automatically when the backend starts. When upgrading, just pull the new images and restart.

2.  **Create `.env`** with secure passwords
    ```bash
    DB_PASSWORD=your_secure_db_password
    REDIS_PASSWORD=your_secure_redis_password
    API_KEY_SECRET=your_32_character_secret_key_here
    ```

3.  **Start the stack**
    ```bash
    docker compose up -d
    ```

4.  **Access LogWard**
    * **URL:** `http://localhost:3000`
    * **First Time?** Click "Sign up" to create your account
    * **Then:** Create your first organization and project

**Docker Images:** [Docker Hub](https://hub.docker.com/r/logward/backend) | [GitHub Container Registry](https://github.com/logward-dev/logward/pkgs/container/logward-backend)

> **Production:** Pin versions with `image: logward/backend:0.2.4` instead of `latest`.

---

## 📦 SDKs & Integrations

We have ready-to-use SDKs for the most popular languages.

| Language | Status | Package / Link |
| :--- | :--- | :--- |
| **Node.js** | ✅ Ready | [`@logward-dev/sdk-node`](https://www.npmjs.com/package/@logward-dev/sdk-node) |
| **Python** | ✅ Ready | [`logward-sdk`](https://pypi.org/project/logward-sdk/) |
| **Go** | ✅ Ready | [`logward-sdk-go`](https://github.com/logward-dev/logward-sdk-go) |
| **PHP** | ✅ Ready | [`logward-dev/sdk-php`](https://packagist.org/packages/logward-dev/sdk-php) |
| **Kotlin** | ✅ Ready | [`logward-sdk-kotlin`](#) |
| **Docker** | ✅ Ready | Use Fluent Bit / Syslog driver |
| **HTTP** | ✅ Ready | [API Reference](#) |
| **OpenTelemetry** | ✅ Ready | OTLP endpoint (logs + traces) |

---

## ✨ Features available in Alpha

* ✅ **High-Performance Ingestion:** Batch API handling thousands of logs/sec.
* ✅ **Real-time Live Tail:** See logs as they arrive via Server-Sent Events (SSE).
* ✅ **Powerful Search:** Filter by service, level, time range, and full-text search.
* ✅ **Multi-Organization:** Isolate teams and projects strictly.
* ✅ **Alerting:** Get notified via Email or Webhook (Slack/Discord) on error spikes.
* ✅ **Retention Policy:** Automatic cleanup of old logs via TimescaleDB.
* ✅ **Sigma Rules Detection:** Built-in engine to run security detection rules (YAML) against your logs, effectively turning LogWard into a lightweight SIEM for threat detection.
* ✅ **OpenTelemetry Support:** Native OTLP ingestion for logs and traces (protobuf + JSON).
* ✅ **Distributed Tracing:** Trace viewer with span timeline, service dependencies graph, and trace-to-logs correlation.

---

## 🛡️ Security & Sigma Rules

LogWard goes beyond simple monitoring by transforming your logs into a security advantage. We support **Sigma Rules**, the industry-standard format for describing log signatures.

* **Threat Detection:** Automatically detect suspicious activities (e.g., SSH brute force, clearing of history, web shells).
* **Standard Format:** Write rules in standard YAML or import existing ones from the [Sigma community](https://github.com/SigmaHQ/sigma).
* **Real-time Matching:** Rules are evaluated against incoming logs in real-time.

**Example Rule (Detecting History Clear):**

```yaml
title: Clear Command History
status: stable
logsource:
    product: linux
detection:
    selection:
        command:
            - 'history -c'
            - 'cat /dev/null > ~/.bash_history'
    condition: selection
level: high
```

---

## 🏗️ Tech Stack

We use modern, type-safe tools to ensure performance and maintainability.

| Layer | Technology |
| :--- | :--- |
| **Frontend** | SvelteKit 5 (Runes) + TailwindCSS + shadcn-svelte |
| **Backend** | Fastify + TypeScript + Kysely ORM |
| **Database** | PostgreSQL 16 + TimescaleDB (Time-series optimization) |
| **Queue** | Redis 7 + BullMQ |
| **Deployment** | Docker + Docker Compose |

---

## 📄 License

Distributed under the **GNU AGPLv3** License. See `LICENSE` for more information.

* **Free for Internal Use:** You can use LogWard internally for free.
* **Open Source:** The code is available for audit and contribution.
* **Commercial Protection:** If you offer LogWard as a SaaS (Service) to others, you must release your source code or purchase a Commercial License.

---

<div align="center">
  <br />
  <p>Built with ❤️ in Europe</p>
  <p>
    <a href="https://logward.dev"><strong>Start for Free</strong></a> •
    <a href="https://github.com/logward-dev/logward/issues">Report a Bug</a>
  </p>
</div>
