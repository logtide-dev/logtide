# Security Policy

## Reporting a Vulnerability

At LogTide, we prioritize the security of our users' data and strive to maintain a robust and secure platform. If you discover any potential threats or vulnerabilities in our system, we kindly ask that you notify us immediately.

### How to Report

1. **Email**: Send an email to [support@logtide.dev](mailto:support@logtide.dev) with details of the discovered vulnerability.

2. **Include**:
   - A detailed description of the vulnerability
   - Steps to reproduce the issue
   - Any potential impact or exploitability
   - Your contact information for follow-up

### Guidelines

- **Do Not Exploit**: Do not take advantage of the vulnerability for personal gain or to harm the platform or its users.
- **No Data Destruction**: Do not delete or destroy any data while investigating the vulnerability.
- **Confidentiality**: Keep the details of any discovered vulnerabilities confidential until they are resolved.
- **Good Faith**: Act in good faith to avoid privacy violations, destruction of data, and interruption or degradation of our services.

### Our Commitment

We are committed to:

- **Acknowledging your report** within 48 hours
- **Working with you** to understand and validate the issue
- **Keeping you informed** of our progress in resolving the issue
- **Crediting you** in our security acknowledgments (if desired)
- **Not pursuing legal action** against researchers who follow these guidelines

## Security Acknowledgments

We thank the following researchers for responsibly disclosing security issues:

- **Bertie** — cross-tenant authorization gaps in project-scoped routes (alert preview/creation, monitor creation, source map list/delete) and SSRF / internal port-scanning via HTTP/TCP monitors and webhook delivery. Fixed in 0.9.6.
- **tonghuaroot** — SSRF in the alert/Sigma webhook delivery path, which still used the bypassable inline filter instead of the centralized `safeFetch` guard (incomplete-fix sibling-gap of the 0.9.6 hardening). Fixed in 0.9.7. (GHSA-7v53-pw6r-99vj)
- **KIberblick.de** ([kiberblick.de](https://kiberblick.de)) — cross-tenant read on the dashboard API endpoints (organization taken from the attacker-supplied query string under API-key auth) and stored XSS via OTLP `service.name` in the service map; plus an open redirect on the auth-free login/register path, a DNS-rebinding gap in the SSRF guard's HTTP path, a first-admin bootstrap promotion race, and a capability-limit check-then-act race. Fixed in 1.0.3.

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: |
| 0.9.x   | :x:                |
| 0.8.x   | :x:                |
| 0.7.x   | :x:                |
| 0.6.x   | :x:                |
| 0.5.x   | :x:                |
| 0.4.x   | :x:                |
| 0.3.x   | :x:                |
| 0.2.x   | :x:                |
| 0.1.x   | :x:                |

## Security Best Practices

When self-hosting LogTide, we recommend:

1. **Keep LogTide updated** to the latest version
2. **Use HTTPS** for all connections
3. **Secure your database** with strong passwords and network isolation
4. **Enable rate limiting** (configured by default)
5. **Regularly rotate API keys**
6. **Monitor access logs** for suspicious activity
7. **Use environment variables** for sensitive configuration (never commit secrets)

## Security Features

LogTide includes several built-in security features:

- **API Key Authentication** with SHA-256 hashing
- **Session-based Authentication** with secure token generation
- **Rate Limiting** on all endpoints
- **Input Validation** using Zod schemas
- **SQL Injection Protection** via parameterized queries (Kysely)
- **XSS Protection** via Content Security Policy headers
- **CORS Configuration** for cross-origin requests
- **Helmet.js** for HTTP security headers

## Contact

For any security-related questions or concerns, please contact us at [support@logtide.dev](mailto:support@logtide.dev).
