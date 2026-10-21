# Changelog

All notable changes to Anomaly Zoo are recorded here. The engine follows [Semantic Versioning](https://semver.org/); `engine/trace.EngineVersion` is the engine version and appears in every trace and in `conformance.json`.

## [Unreleased]

Work towards 1.0.0. Nothing has been tagged or deployed to production yet.

### Added
- MVCC engine in Go (standard library only) with four isolation levels: Read Uncommitted, Read Committed, Snapshot Isolation and a simplified Serializable (SSI-lite); scenario language (`.azs`) with a hand-written parser; serializability oracle; deterministic traces with a SHA-256 digest; eight canned scenarios and their expected matrix.
- Reproducible WebAssembly build of the engine with a committed hash checked in CI; native and WebAssembly digests agree on every canned scenario.
- Website (Next.js static export): habitat map, anomaly pages with a step-through timeline, store and explain panels, level comparison, a playground with share links and a "re-run in your browser" check, share images, About page.
- PostgreSQL conformance harness (`conformance/`) comparing the engine with PostgreSQL 16 at Read Committed, Snapshot Isolation and Serializable; measured results and five documented divergences (`docs/METHODOLOGY.md`, About page); PostgreSQL badges on anomaly pages.
- Hardening: per-page Content-Security-Policy with script hashes, response headers, strict input limits and string caps, `SECURITY.md`, `THIRD_PARTY_NOTICES.md` (generated), Dependabot, CodeQL, vulnerability scans in CI, a repository-controls checker (`scripts/verify-hardening.mjs`), fuzz targets `FuzzParse` and `FuzzRun`, a coverage gate on the engine.

### Changed
- The `conformance` module requires Go 1.27.3 and `golang.org/x/text` 0.41.0 (vulnerability fixes found by `govulncheck`).
