# Security policy

Anomaly Zoo is a static website plus a small Go engine compiled to WebAssembly. It has no accounts, no server code, no database and no cookies, and it makes no third-party requests. The things that could go wrong are listed in `spec.md` section 10.1 (cross-site scripting through crafted share links or scenario text, resource exhaustion from huge inputs, a compromised dependency, a tampered build, framing of the site).

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Open <https://github.com/Aditya-tec/anomaly-zoo/security/advisories/new> (GitHub private vulnerability reporting), or use the **Security** tab of the repository and choose **Report a vulnerability**.
2. Describe what you found, how to reproduce it (a share link or scenario that triggers it is ideal) and what you think the impact is.

Please do not publish details before a fix is available, and please do not test against other people's browsers or infrastructure.

## What to expect

This is a one-person, spare-time project, so the promises are modest ones I can keep:

* an acknowledgement within **7 days**;
* an assessment (is it a vulnerability, how serious) within **14 days**;
* a fix, or a clear statement of why there will not be one, within **30 days** for anything that affects visitors.

Reporters are credited in the release notes unless they prefer not to be.

## Supported versions

Only the latest release of the site and engine (the `main` branch and the most recent tagged version) is supported. Older tags are not patched; the site is a single deployment, so there is no long-lived installation to maintain.

## Scope

In scope: the website, the engine and its WebAssembly build, the build and CI configuration in this repository.
Out of scope: the hosting provider's infrastructure, social-engineering of the maintainer, vulnerabilities that need a modified browser or local access, and reports that only restate a missing header or setting that is already documented as a deliberate decision in `docs/DECISIONS.md`.

## Verifying a release

The About page prints the SHA-256 of the WebAssembly engine. Rebuilding it from source with the pinned Go toolchain (`go run ./tools/buildwasm -verify`) must give the same hash; CI checks this on every push.
