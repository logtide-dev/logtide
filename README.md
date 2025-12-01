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
  <img src="https://img.shields.io/badge/version-0.2.1-blue.svg" alt="Version">
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
    curl -X POST [https://api.logward.dev/api/v1/ingest](https://api.logward.dev/api/v1/ingest) \
      -H "X-API-Key: YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{ "logs": [{ "service": "test", "level": "info", "message": "Hello Cloud!" }] }'
    ```

### Option B: Self-Hosted (Docker)
Total control over your data.

**Prerequisites:** Docker & Docker Compose.

1.  **Clone the repo**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/logward.git](https://github.com/YOUR_USERNAME/logward.git)
    cd logward
    ```

2.  **Start the stack**
    ```bash
    docker compose up -d
    ```

3.  **Access LogWard**
    * **URL:** `http://localhost:3000`
    * **First Time?** Click "Sign up" to create your account
    * **Then:** Create your first organization and project

---

## 📦 SDKs & Integrations

We have ready-to-use SDKs for the most popular languages.

| Language | Status | Package / Link |
| :--- | :--- | :--- |
| **Node.js** | ✅ Ready | [`@logward-dev/sdk-node`](https://www.npmjs.com/package/@logward-dev/sdk-node) |
| **Python** | ✅ Ready | [`logward-sdk`](https://pypi.org/project/logward-sdk/) |
| **PHP** | ✅ Ready | [`logward-dev/sdk-php`](https://packagist.org/packages/logward-dev/sdk-php) |
| **Kotlin** | ✅ Ready | [`logward-sdk-kotlin`](#) |
| **Docker** | ✅ Ready | Use Fluent Bit / Syslog driver |
| **HTTP** | ✅ Ready | [API Reference](#) |
| **OpenTelemetry** | ✅ Ready | OTLP endpoint (logs + traces) |

> **Note:** Go (Golang) support is coming soon. Use the HTTP API or OpenTelemetry SDK for now.

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
