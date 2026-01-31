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

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
|---------|--------------------|
| 0.5.x   | :white_check_mark: |
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
