# Changelog

All notable changes to LogWard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2025-12-22

### Fixed

- **SvelteKit 2 Compatibility**: Updated imports from `$app/stores` to `$app/state` and adjusted event handlers (#55)
  - Migrated deprecated `$app/stores` imports to the new `$app/state` module
  - Updated event handlers to use the new SvelteKit 2 patterns
  - Ensures compatibility with latest SvelteKit versions

- **Traces Page Navigation**: Fixed "Get API Key" button on empty traces page leading to 404 (#53)
  - Corrected navigation path from `/projects` to `/dashboard/projects`
  - Fixed navigation buttons on the 404 error page
  - Fixed feature tour links missing `/dashboard` prefix (search, alerts, traces, projects)
  - Fixed trace detail page "Back to Traces" navigation

- **Registration Error**: Fixed "Failed to fetch" error during user registration (#54, fixes #52)
  - Resolved network error that prevented new users from completing registration
  - Improved error handling in the registration flow

---

## [0.3.1] - 2025-12-19

### Changed

- **Security Policy**: Updated supported versions in SECURITY.md

---

## [0.3.0] - 2025-12-10

### Added

- **SIEM Dashboard**: Full-featured Security Information and Event Management interface
  - Security Dashboard with 6 real-time widgets:
    - Summary stats (total detections, incidents, open, critical)
    - Top threats chart (Sigma rules ranked by detection count)
    - Detection timeline (time-series visualization)
    - Affected services list
    - Severity distribution pie chart
    - MITRE ATT&CK heatmap (techniques across tactics matrix)
  - Incident List page with filtering (status, severity) and pagination
  - Incident Detail page with three tabs:
    - Detections: matched log events with field details
    - Comments: collaboration thread for incident response
    - History: full activity timeline of status changes
  - Incident status workflow (Open → Investigating → Resolved → False Positive)
  - Assignee management for incident ownership
  - PDF export for incident reports (print-based generation)
  - Real-time updates via SSE (Server-Sent Events)

- **C# / .NET SDK**: Official SDK for .NET 6/7/8 applications
  - Full documentation at `/docs/sdks/csharp`
  - Automatic batching with configurable size and interval
  - Retry logic with exponential backoff
  - Circuit breaker pattern for fault tolerance
  - Query API for searching and filtering logs
  - Trace ID context for distributed tracing
  - ASP.NET Core middleware for auto-logging HTTP requests
  - Dependency injection support
  - Thread-safe, full async/await support

- **IP Reputation & GeoIP Enrichment** (Backend ready, UI in incident detail)
  - IP reputation lookup integration
  - GeoIP data display with map visualization
  - Enrichment cards in incident detail view

- **Organization Invitations**: Invite users to join your organization
  - Send email invitations to new team members
  - Pending invitations management (view, resend, revoke)
  - Role assignment on invite (admin, member)
  - Invitation acceptance flow with automatic org membership
  - Invitation expiration handling

- **Horizontal Scaling Documentation**: Guide for scaling LogWard across multiple instances
  - Traefik reverse proxy configuration with load balancing
  - Docker Compose overlay for scaled deployments
  - Sticky sessions for SSE connections
  - Health check configuration for backend instances
  - Environment variables for scaling configuration

### Changed

- **Homepage**: Added Go and C# to "Works with your stack" section
- **SDK Overview**: Added C# SDK card with installation and features
- **Sidebar Navigation**: Added C# / .NET link to SDKs section
- **README**:
  - Added SIEM Dashboard screenshot
  - Added SIEM feature to Alpha features list
  - New dedicated section for SIEM Dashboard & Incident Management
  - Added C# SDK to SDKs table
  - Updated Kotlin SDK link to GitHub repository

### Fixed

- PDF export now properly connected in incident detail page (was missing `onExportPdf` prop)

---

## [0.2.4] - 2025-12-04

### Added

- **Syslog Integration Documentation**: New guide for collecting logs from infrastructure
  - Fluent Bit configuration for syslog UDP/TCP on port 514
  - Parsers for RFC 3164 (traditional) and RFC 5424 (modern) syslog formats
  - Lua script for mapping syslog severity to log levels
  - Device-specific guides: Proxmox VE, VMware ESXi, UniFi, pfSense, Synology
  - Credit to Brandon Lee / VirtualizationHowto for inspiration

- **Go SDK Documentation**: Official SDK docs at `/docs/sdks/go`
  - Installation, quick start, configuration options
  - Logging methods, error handling, OpenTelemetry integration
  - HTTP middleware examples (standard library, Gin)

- **Documentation Restructure**
  - New "Integrations" section in docs sidebar (Syslog, OpenTelemetry)
  - Go SDK added to SDK overview and sidebar

### Changed

- **Docker Compose**: Improved container orchestration
  - Worker now depends on backend health (fixes migration race condition)
  - Redis healthcheck fixed with proper authentication
  - Updated all docker-compose files (production, dev, README, docs)

- **Onboarding Flow**: Fixed "Skip tutorial" behavior
  - Skip now goes to organization creation (required step)
  - After creating org, redirects to dashboard instead of continuing tutorial
  - Added `skipAfterOrgCreation` flag to onboarding store

- **Runtime Configuration**: Fixed PUBLIC_API_URL build-time vs runtime issue
  - Components now use `getApiUrl()` for runtime configuration
  - API URL can be changed via environment variables without rebuild
  - Affected: ApiKeyStep, FirstLogStep, EmptyLogs, EmptyTraces, EmptyDashboard

### Fixed

- "Sign Up Free" link on landing page pointing to non-existent `/signup` (now `/register`)
- Skip tutorial redirect loop to `/onboarding`
- API URL in code examples showing localhost instead of configured URL

## [0.2.3] - 2025-12-03

### Added

- **Docker Image Publishing**: Automated CI/CD for container distribution
  - GitHub Actions workflow (`publish-images.yml`) for building and pushing images
  - Multi-platform builds (linux/amd64, linux/arm64)
  - Automatic semantic versioning tags (e.g., 0.2.3, 0.2, 0, latest)
  - **Docker Hub**: `logward/backend`, `logward/frontend`
  - **GitHub Container Registry**: `ghcr.io/logward-dev/logward-backend`, `ghcr.io/logward-dev/logward-frontend`
  - Triggered on git tags (`v*.*.*`) or manual workflow dispatch

- **Self-Hosting Documentation**: Comprehensive deployment guides
  - Updated README with inline `docker-compose.yml` example
  - New deployment docs with pre-built images as recommended method
  - Environment variables reference table
  - Production tips (version pinning, SSL, backups)

### Changed

- **docker-compose.yml**: Now uses pre-built images from Docker Hub by default
  - Configurable via `LOGWARD_BACKEND_IMAGE` and `LOGWARD_FRONTEND_IMAGE` environment variables
  - No local build required for self-hosting

- **Documentation**: Updated all docs pages
  - `/docs` - Quick start with full docker-compose.yml inline
  - `/docs/getting-started` - Installation with pre-built images
  - `/docs/deployment` - Removed install.sh references, added image registry info

## [0.2.2] - 2025-12-02

### Added

- **Onboarding Tutorial**: Comprehensive guided setup for new users
  - Multi-step wizard with progress tracking:
    - Welcome step with personalized greeting
    - Organization creation with validation
    - Project creation with environment presets (Production, Staging, Development, Testing)
    - API key generation with code examples (cURL, Node.js, Python, PHP, Kotlin)
    - First log verification with real-time detection
    - Feature tour highlighting key capabilities
  - Skip and resume functionality (persisted to localStorage)
  - Mobile responsive design
  - Full keyboard accessibility (ARIA labels, focus management)
  - Backend API: `GET/POST /api/v1/onboarding/state`

- **Empty State Components**: Helpful guidance when no data exists
  - `EmptyLogs`: Guidance for log search with quick actions
  - `EmptyTraces`: Trace collection setup instructions
  - `EmptyDashboard`: Getting started checklist for new users

- **User Onboarding Checklist**: Persistent progress tracking
  - Sidebar widget showing setup completion status
  - Automatic detection of completed steps
  - Quick navigation to incomplete tasks
  - Dismissible after completion

- **UI Enhancements**
  - `HelpTooltip` component for contextual help
  - `FeatureBadge` component for feature highlighting
  - `Progress` component for visual progress bars
  - `UserSettingsDialog` with tutorial restart option

### Changed

- **Testing Infrastructure**: Significantly expanded test coverage
  - Backend: 897 tests (up from 563), **77.34% coverage** (up from 71%)
  - E2E: ~70 Playwright tests across 10 test files
  - New E2E journeys: onboarding flow, empty states, accessibility
  - Mobile responsive testing with viewport simulation

### Fixed

- Improved organization context handling in dashboard navigation
- Better error states and loading indicators throughout the app

## [0.2.1] - 2025-12-01

### Added

- **Redis Caching Layer**: Comprehensive caching to minimize database load
  - CacheManager utility with type-safe keys and configurable TTLs
  - Session validation caching (30 min TTL, invalidated on logout)
  - API key verification caching (60 sec TTL, async last_used updates)
  - Query result caching with deterministic keys (60 sec TTL)
  - Trace and aggregation caching (5 min TTL)
  - Automatic cache invalidation on log ingestion
  - Admin API endpoints for cache management:
    - `GET /api/v1/admin/cache/stats` - Cache hit/miss statistics
    - `POST /api/v1/admin/cache/clear` - Clear all cache
    - `POST /api/v1/admin/cache/invalidate/:projectId` - Invalidate project cache
  - Configuration via `CACHE_ENABLED` and `CACHE_TTL` environment variables

- **Landing Page**: New public index page for the application

### Changed

- **Database Optimization**: Comprehensive optimizations for sub-100ms query latency
  - New composite indexes for common query patterns:
    - `idx_logs_project_level_time` (project + level filtering)
    - `idx_logs_project_service_time` (project + service filtering)
    - `idx_logs_project_service_level_time` (combined filtering)
    - `idx_logs_project_errors` (partial index for error logs)
  - TimescaleDB Continuous Aggregates:
    - `logs_hourly_stats` for dashboard timeseries (10-50x faster)
    - `logs_daily_stats` for historical analytics
  - Compression policy changed from 7 days to 1 day (90% storage reduction)
  - PostgreSQL tuning (parallel queries, shared_buffers, work_mem, WAL)
  - Connection pooling with environment-based sizing (5/10/20 connections)
  - Statement timeout protection (30s prod, 60s dev)
  - Admin health endpoint with pool statistics

### Performance

- Session validation: ~30x faster (cache hit)
- API key verification: ~20x faster (cache hit)
- Query results: ~10x faster (cache hit)
- Aggregations: ~50x faster (cache hit)
- Verified: 722,890 logs ingested at 7.40ms P95, 0% errors

### Fixed

- **Admin Panel**: Fixed double sidebar and footer issue (layout inheritance reset)
- **Admin Routes**: Fixed incorrect navigation paths (missing `/dashboard` prefix)
  - User Management links now correctly navigate to user details
  - Organization Management links now correctly navigate to organization details
  - Projects Management links now correctly navigate to project details

## [0.2.0] - 2025-11-29

### Added

- **OpenTelemetry Support**: Full OTLP (OpenTelemetry Protocol) integration
  - `POST /v1/otlp/logs` endpoint for log ingestion (protobuf + JSON)
  - `POST /v1/otlp/traces` endpoint for trace ingestion
  - Automatic trace_id and span_id extraction
  - Resource attributes mapping to metadata
  - Severity number to log level conversion

- **Distributed Tracing**
  - Traces API with full CRUD operations
  - Span timeline visualization (Gantt chart)
  - Trace-to-logs correlation (click span to see related logs)
  - Service dependencies graph visualization
  - Keyboard accessibility for span selection

- **Testing Infrastructure**
  - 563+ backend tests with 71% coverage
  - 60 E2E tests with Playwright
  - Test factories for spans and traces
  - Load testing scripts with k6

### Changed

- Optimized OTLP ingestion performance for high-throughput scenarios
- Enhanced span selection UX with keyboard navigation
- Optimized service dependencies query performance

### Fixed

- Frontend UX issues during OTLP data display
- Trace_id handling now accepts any string format

## [0.1.0] - 2025-11-01

### Added

- Initial public alpha release
- Multi-organization architecture with data isolation
- High-performance batch log ingestion API
- Real-time log streaming via Server-Sent Events (SSE)
- Advanced search and filtering (service, level, time, full-text, trace_id)
- TimescaleDB compression and automatic retention policies
- Dashboard with organization-wide statistics
- Alert system with threshold-based rules
- Email and webhook notifications
- Sigma detection engine for security rules
- Official SDKs: Node.js, Python, PHP, Kotlin
- Docker Compose deployment support
