# Contributing to LogTide

First off, thank you for considering contributing to LogTide! It's people like you that make LogTide such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [support@logtide.dev](mailto:support@logtide.dev).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title** for the issue
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** to demonstrate the steps
- **Describe the behavior you observed** and what you expected to see
- **Include screenshots or logs** if applicable
- **Include your environment details** (OS, Node.js version, browser, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the suggested enhancement
- **Explain why this enhancement would be useful** to most LogTide users
- **List any alternative solutions** you've considered

### Pull Requests

1. **Fork the repository** and create your branch from `develop`
2. **Install dependencies** with `pnpm install`
3. **Make your changes** following our coding standards and the [architectural rules](#architectural-rules)
4. **Add tests** for any new functionality
5. **Ensure all tests pass** with `pnpm test`
6. **Update documentation** if needed, and add an entry to `CHANGELOG.md` under `## [Unreleased]`
7. **Submit a pull request against `develop`** (`main` only receives release merges)

For larger changes (new storage engine methods, schema changes, changes to the ingestion or buffer paths), please describe your plan in the issue first so we can agree on the design before you write the code.

Keep each pull request focused on one problem: no unrelated refactors, dependency upgrades or formatting churn in the same PR.

#### Contributor License Agreement

Before your first pull request can be merged you need to sign the Contributor License Agreement (CLA). A bot posts a comment on your first PR with a link; read the agreement text it shows, then sign by commenting as the bot asks. You sign once, for all your future contributions. You can also sign ahead of time at <https://cla-assistant.io/logtide-dev/logtide>.

The bot recognises you through the email address on your commits, so **commit with an email address that is linked to your GitHub account** (check it under GitHub Settings, Emails). Commits made with an unlinked email cannot be matched to your account and the CLA check will stay pending.

Contributions to the core are licensed under the AGPLv3 like the rest of the code. LogTide is open core, and the CLA also allows the maintainer to use contributions in commercial editions. See the agreement text shown by the bot for the exact terms.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- Docker and Docker Compose (for local development)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/logtide-dev/logtide.git
cd logtide

# Install dependencies
pnpm install

# Build shared package
pnpm build:shared

# Start development environment
docker compose -f docker/docker-compose.dev.yml up -d  # Start PostgreSQL and Redis
pnpm dev                                               # Start backend and frontend
```

### Project Structure

```
logtide/
├── packages/
│   ├── backend/      # Fastify API server and worker
│   ├── frontend/     # SvelteKit dashboard
│   ├── reservoir/    # Storage abstraction (TimescaleDB, ClickHouse, MongoDB)
│   └── shared/       # Shared types and schemas
├── docker/           # Docker Compose profiles
├── load-tests/       # k6 load-test scenarios
└── docs/             # Documentation
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run backend tests with coverage
cd packages/backend && pnpm test:ci:coverage

# Run E2E tests
pnpm test:e2e
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Avoid `any` types where possible
- Use explicit return types for functions

### Code Style

- Use Prettier for formatting (configured in project)
- Use meaningful variable and function names
- Write self-documenting code with comments for complex logic
- Keep functions small and focused

### Commits

- Use clear, descriptive commit messages
- Reference issues in commits when applicable (e.g., `fixes #123`)
- Keep commits atomic and focused on a single change

### Testing

- Write tests for new features, and a regression test for every bug fix
- Backend coverage must stay at or above 80% (lines, functions, branches, statements); CI enforces it, including patch coverage on the lines you change
- Changes to `packages/reservoir` must be tested on all three engines; start the ClickHouse and MongoDB containers with `docker compose -f packages/reservoir/docker-compose.test.yml up -d`
- Use descriptive test names that explain the expected behavior

### Language

- Everything in the repository and on GitHub is in English: code, comments, commit messages, pull requests, issues and documentation

## Architectural Rules

These rules protect guarantees that LogTide users rely on. A pull request that breaks one of them will not be merged, even if it is faster or simpler.

### Multi-engine storage

LogTide stores logs, spans and metrics on TimescaleDB, ClickHouse or MongoDB through the `reservoir` package. Any new or changed storage method needs a real implementation on all three engines. A generic fallback in the base engine is fine as a safety default, but do not optimize one engine and leave the others behind.

### Tenant isolation

The organization is a hard isolation boundary and API keys are scoped to a single project. Every query and write against tenant data must carry organization or project scoping, and batch operations must never merge or deduplicate records across projects. CI runs a static check (`pnpm --filter @logtide/backend check:tenant-scoping`) that must stay green.

### PII masking is fail-closed

Logs and spans are masked before they are stored, and records whose masking fails are rejected or dropped. Never add a code path where unmasked data reaches storage, a queue or a buffer, and never turn a masking failure into a warning that lets the record through.

### Correctness before speed

Performance work must not change results. Counters, aggregates and summaries must stay correct under concurrent and batched writes, including when the async ingestion buffer (`RESERVOIR_BUFFER_ENABLED`) is on. Existing behavior such as metering, quotas and clock-skew detection must keep working exactly as before unless the change is the point of the PR.

### Use the existing abstractions

- Background jobs go through the queue layer, which supports both BullMQ and graphile-worker; do not bind a feature to one backend
- Outbound HTTP calls to user-supplied URLs go through the webhook dispatcher (SSRF guard, signing, retries)
- New resource-creating endpoints go through the capability system so limits and quotas apply

### Schema changes

Database changes go in a new numbered migration; never edit a migration that has already been released. Changes that need existing installations to be upgraded (for example a new ClickHouse table engine) must include an upgrade path and should be discussed in the issue first.

### Deployment footprint

Fixes and features must work on the default Docker Compose profile. Do not introduce new required external services.

## Documentation

- Update README.md if you change functionality
- Add JSDoc comments for public APIs
- Add an entry to `CHANGELOG.md` under `## [Unreleased]` for every user-visible change

## Questions?

Feel free to reach out:

- **Email**: [support@logtide.dev](mailto:support@logtide.dev)
- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and community discussions

Thank you for contributing to LogTide!
