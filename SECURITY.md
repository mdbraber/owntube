# Security Policy

## Supported versions

OwnTube is a solo project. Only the latest released version on `main` is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Instead, use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository, or email me directly if you can find my address on my GitHub profile.

In your report, please include:

- A clear description of the issue and the impact
- Steps to reproduce, or a minimal proof-of-concept
- Affected version / commit hash
- Whether the issue is already public anywhere

I'll do my best to acknowledge the report within a few days, and to ship a fix or mitigation as soon as I can confirm it. If I can't (or won't) fix it, I'll explain why.

## Scope

In scope:

- Authentication and session handling (`src/server/auth.ts`, Auth.js usage)
- tRPC endpoints, especially anything that mutates user data
- The YouTube gateway (`apps/gateway`): its catalogue API (bearer key) and the signed playback URLs under `/media/*`
- SQL handling (Drizzle, raw SQL in migrations)
- The Docker image and `docker-compose.yml`

Out of scope:

- Issues in YouTube itself, or in youtubei.js / googlevideo (please report those upstream)
- Brute-force or rate-limit issues without a working PoC
- Self-XSS that requires the user to paste hostile JS in DevTools
- Deprecated dependencies that have no known exploit

## Self-hosting hardening

A few notes for operators:

- **Always** set strong, separate `AUTH_SECRET` and `GATEWAY_SIGNING_KEY` values (`openssl rand -base64 48`). The web app and the gateway refuse to start in production while either is missing or still a placeholder from an example env file.
- Put OwnTube behind a reverse proxy with TLS (Caddy, nginx, Traefik, …). Don't expose port 3000 directly to the internet.
- Back up `data/owntube.db` regularly — see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md#backups).
- Keep the gateway's port (8080) internal: only `/media/*` should reach it, through your reverse proxy.
