# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- iPhone/iPad: videos with captions failed to start on native HLS (`MEDIA_ERR_SRC_NOT_SUPPORTED`) and fell back to the progressive split path, which stalls on iOS and has no audio-language picker. Caption `<track>`s are now attached once the source has loaded metadata.

## [0.1.0] - 2026-04-27

First public release. The full backlog (P0 → P3) is implemented and reasonably stable on a single-user setup.

### Added

- **P0 — MVP**
  - Search, watch and history with Vidstack player and split-audio fallback
  - Like / dislike / save interactions
  - Piped primary + Invidious fallback proxy with 6h `video_cache` and stale-cache fallback when both upstreams are down
  - Auth.js v5 with credentials provider (bcrypt)
  - Process-wide upstream rate limiter (~60 req/min)
  - Vitest unit tests + Playwright smoke test
- **P1 — Core experience**
  - Personal recommendation feed (TF-IDF on titles + tags, cosine similarity, MMR with λ=0.7, time decay, 15% exploration)
  - Cold-start strategy for new accounts (categorized trending → related videos → full algorithm)
  - Trending page with regional selection
  - Subscriptions: subscribe to channels + chronological merged feed
  - Channel pages with profile and uploads
- **P2 — Polish**
  - Light/dark theme switcher (Zustand store + Tailwind v4)
  - `/settings` with per-user Piped/Invidious overrides, instance health checks, and JSON export/import
  - Picture-in-Picture button + keyboard shortcuts in the player (`i` for PiP, others wired to Vidstack defaults)
  - Docker Compose with healthcheck and `restart: unless-stopped`
  - Self-hosting guide ([docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)) covering Invidious setup script, Piped guide pointer, public instance picker, and a backup cron template
- **P3 — Advanced**
  - Multi-user accounts with per-user data isolation
  - YouTube Takeout watch-history import (`takeout.importHistory`)
  - `/dashboard` with personal stats
  - `/playlists` for local playlists (schema + tRPC router)
  - PWA basics: manifest + service worker + registration

### Tooling / infra

- Biome 2 as the only linter/formatter (no ESLint, no Prettier)
- Drizzle ORM with `better-sqlite3`, migrations in `src/server/db/migrations/`
- pnpm 9.15 pinned via `packageManager`
- Multi-stage Dockerfile + Compose
- Optional self-hosted Invidious via `scripts/setup-invidious.sh`

[Unreleased]: https://github.com/spookiss/owntube/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/spookiss/owntube/releases/tag/v0.1.0
