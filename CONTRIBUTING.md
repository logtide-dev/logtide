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

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies** with `pnpm install`
3. **Make your changes** following our coding standards
4. **Add tests** for any new functionality
5. **Ensure all tests pass** with `pnpm test`
6. **Update documentation** if needed
7. **Submit a pull request**

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
docker-compose up -d  # Start PostgreSQL and Redis
pnpm dev              # Start backend and frontend
```

### Project Structure

```
logtide/
├── packages/
│   ├── backend/      # Fastify API server
│   ├── frontend/     # SvelteKit dashboard
│   └── shared/       # Shared types and schemas
├── docs/             # Documentation
└── docker-compose.yml
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

- Write tests for new features
- Maintain test coverage above 70%
- Use descriptive test names that explain the expected behavior

## Documentation

- Update README.md if you change functionality
- Add JSDoc comments for public APIs
- Update CHANGELOG.md for notable changes

## Questions?

Feel free to reach out:

- **Email**: [support@logtide.dev](mailto:support@logtide.dev)
- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and community discussions

Thank you for contributing to LogTide!
