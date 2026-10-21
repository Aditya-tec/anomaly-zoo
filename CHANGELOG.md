# Changelog

All notable changes to Anomaly Zoo are recorded here. The engine follows [Semantic Versioning](https://semver.org/); `engine/trace.EngineVersion` is the engine version and appears in every trace and in `conformance.json`.

## [1.0.0] - not yet tagged

The first release candidate: everything below is built, tested and pushed to `main`. It has not been deployed or tagged; the tag and the deployment are the owner's steps (`docs/RELEASE-CHECKLIST.md`).

### Added
- **Engine** (Go, standard library only): MVCC store, transaction manager (write locks with first-in-first-out waiting, deadlock detection, first-updater-wins) and four isolation levels: Read Uncommitted, Read Committed, Snapshot Isolation and a simplified Serializable ("SSI-lite"). A hand-written scenario language (`.azs`) with limits and string caps, a serializability oracle with a shrinker, deterministic traces with a SHA-256 digest and a JSON Schema, eight canned scenarios and their expected matrix, golden traces, property tests, mutation checks for the five Serializable rules, and fuzz targets `FuzzParse` and `FuzzRun`.
- **Command line** (`azoo`): `run`, `matrix`, `traces`, `gen`, `version`.
- **WebAssembly build** of the engine, reproducible, with its hash committed and checked in CI; native and WebAssembly digests agree on every canned trace.
- **Website** (Next.js static export): habitat map, a step-through page for each of the eight anomalies (timeline, store and explain panels, level comparison), a playground with share links and a "re-run in your browser" check, share images, an About page.
- **PostgreSQL comparison** (`conformance/`, separate Go module): a differential harness against PostgreSQL 16 at Read Committed, Snapshot Isolation and Serializable; measured results, five documented differences each with a minimal schedule (two with "cause not yet established"), PostgreSQL badges on the anomaly pages, a sharded nightly workflow. Method and results: `docs/METHODOLOGY.md`, `web/public/conformance.json`.
- **Security and quality checks:** per-page Content-Security-Policy with script hashes and no `unsafe-inline` for styles, response headers, `SECURITY.md`, `THIRD_PARTY_NOTICES.md` (generated), Dependabot, CodeQL, vulnerability scans, a repository-controls checker, a coverage gate on the engine, a claims-policy checker (banned phrases and figures that are in no recorded source), end-to-end tests in Chromium, Firefox and WebKit with axe, Lighthouse and size gates.
- **Launch material** (drafts, nothing posted): README with the hero recording, `docs/launch/` (clip, map screenshots, verification diagram, carousel stills, post drafts), `docs/RELEASE-CHECKLIST.md`.

### Known limits
- A key-to-integer model with prefix scans; a deterministic single-threaded simulation; a simplified Serializable level; PostgreSQL 16 only, at three isolation levels, on schedules without DELETE. See the README and the About page.
- Not yet verified: production headers on a deployment, the nightly 10,000-per-level run, the 60-minute fuzz runs, Safari on macOS and real devices.
