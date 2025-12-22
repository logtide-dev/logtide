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
  <a href="https://artifacthub.io/packages/helm/logward/logward"><img src="https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/logward" alt="Artifact Hub"></a>
  <img src="https://img.shields.io/badge/version-0.3.2-blue.svg" alt="Version">
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

### SIEM Dashboard
![LogWard Security](docs/images/security.png)

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

1.  **Download configuration**
    ```bash
    mkdir logward && cd logward
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/docker-compose.yml
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/.env.example
    mv .env.example .env
    ```

2.  **Edit `.env`** with secure passwords
    ```bash
    nano .env
    ```
    Required variables:
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
    * **Frontend:** `http://localhost:3000`
    * **API:** `http://localhost:8080`
    * **First Time?** Click "Sign up" to create your account

> **Note:** Database migrations run automatically on first start.

5.  **(Optional) Enable Docker log collection with Fluent Bit**
    ```bash
    # Download Fluent Bit configuration files
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/fluent-bit.conf
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/parsers.conf
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/extract_container_id.lua
    curl -O https://raw.githubusercontent.com/logward-dev/logward/main/docker/wrap_logs.lua

    # Set your LogWard API key in .env
    echo "FLUENT_BIT_API_KEY=your_api_key_here" >> .env

    # Start with logging profile
    docker compose --profile logging up -d
    ```

**Docker Images:** [Docker Hub](https://hub.docker.com/r/logward/backend) | [GitHub Container Registry](https://github.com/logward-dev/logward/pkgs/container/logward-backend)

> **Production:** Pin versions with `LOGWARD_BACKEND_IMAGE=logward/backend:0.3.2` in your `.env` file.

> **Horizontal Scaling:** For scaling multiple backend instances, see [deployment docs](https://logward.dev/docs/deployment#horizontal-scaling).

### Option C: Kubernetes (Helm)
Deploy LogWard on any Kubernetes cluster with our official Helm chart.

**Prerequisites:** Kubernetes 1.25+, Helm 3.10+

1. **Add the Helm repository**
    ```bash
    helm repo add logward https://logward-dev.github.io/logward-helm-chart
    helm repo update
    ```

2. **Install LogWard**
    ```bash
    helm install logward logward/logward \
      --namespace logward \
      --create-namespace \
      --set timescaledb.auth.password=<your-db-password> \
      --set redis.auth.password=<your-redis-password>
    ```

3. **Access LogWard**
    ```bash
    kubectl port-forward svc/logward-frontend 3000:3000 -n logward
    ```
    Open `http://localhost:3000`

**Includes:** Backend (2+ replicas), Frontend, Worker, TimescaleDB, Redis, HPA, Ingress support, Prometheus monitoring.

> **Helm Chart:** [Artifact Hub](https://artifacthub.io/packages/helm/logward/logward) | [GitHub](https://github.com/logward-dev/logward-helm-chart) | [Full Docs](https://logward.dev/docs/deployment#kubernetes)

---

## 📦 SDKs & Integrations

We have ready-to-use SDKs for the most popular languages.

| Language | Status | Package / Link |
| :--- | :--- | :--- |
| **Node.js** | ✅ Ready | [`@logward-dev/sdk-node`](https://www.npmjs.com/package/@logward-dev/sdk-node) |
| **Python** | ✅ Ready | [`logward-sdk`](https://pypi.org/project/logward-sdk/) |
| **Go** | ✅ Ready | [`logward-sdk-go`](https://github.com/logward-dev/logward-sdk-go) |
| **PHP** | ✅ Ready | [`logward-dev/sdk-php`](https://packagist.org/packages/logward-dev/sdk-php) |
| **Kotlin** | ✅ Ready | [`logward-sdk-kotlin`](https://github.com/logward-dev/logward-sdk-kotlin) |
| **C# / .NET** | ✅ Ready | [`LogWard.SDK`](https://github.com/logward-dev/lgoward-sdk-csharp) |
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
* ✅ **Sigma Rules Detection:** Built-in engine to run security detection rules (YAML) against your logs for threat detection.
* ✅ **SIEM Dashboard:** Security dashboard with incident management, MITRE ATT&CK mapping, and PDF report export. *(New in 0.3.0)*
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

## 🚨 SIEM Dashboard & Incident Management (New in 0.3.0)

LogWard now includes a full-featured **Security Information and Event Management (SIEM)** dashboard, turning your log platform into a lightweight security operations center.

### Security Dashboard
* **Summary Stats:** Total detections, open incidents, critical alerts at a glance
* **Top Threats Chart:** Sigma rules ranked by detection count
* **Detection Timeline:** Time-series visualization of security events
* **Affected Services:** Quick view of which services triggered detections
* **Severity Distribution:** Pie chart breakdown (Critical/High/Medium/Low)
* **MITRE ATT&CK Heatmap:** Visualize detected techniques across the ATT&CK matrix

### Incident Management
* **Incident Workflow:** Track incidents through Open → Investigating → Resolved → False Positive
* **Comments & Collaboration:** Add notes and discuss incidents with your team
* **Activity Timeline:** Full audit trail of all status changes and actions
* **Detection Events:** View matched fields and log context for each detection
* **PDF Export:** Generate incident reports for compliance and documentation

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
