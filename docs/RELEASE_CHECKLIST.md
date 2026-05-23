# Release Checklist

This checklist is the public release gate for Mindory tag builds.

## Required Repository Secrets

- `MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM`: RSA private key used only by the
  release workflow to sign release manifests.
- `GITHUB_TOKEN`: GitHub-provided token used by Actions for pre-release
  artifacts and GitHub Container Registry pushes.

Do not commit signing keys, registry tokens or generated secrets to the
repository.

## Tag Policy

- Version tag: `ghcr.io/<owner>/mindory:<version>`.
- Commit tag: `ghcr.io/<owner>/mindory:<12-char-git-sha>`.
- The workflow does not publish Docker images from pull requests or local
  validation runs.
- The workflow does not publish a mutable `latest` tag.

## Required Checks

- `pnpm check`.
- `pnpm public-ready:gate`.
- `pnpm release:validate`.
- `pnpm published-release:acceptance`.
- `pnpm public-debt:validate`.
- `pnpm selfhost:gate`.
- `git status --short` returns no changes.
- Signed manifest verification through `install.sh` or `install.ps1`
  verify-only mode for the generated manifest.

## Pre-release Contents

- `mindory-<version>.tar.gz`.
- `mindory-<version>.manifest.env`.
- `mindory-<version>.manifest.env.public.pem`.
- `mindory-<version>.sha256`.
- `mindory-<version>.release-notes.md`.

The automated tag workflow must leave the GitHub Release public and marked as a
pre-release. A draft release is allowed only as a manual staging checkpoint
before the trusted tag build updates and publishes the same tag.

After the pre-release is public, run:

```bash
MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true pnpm published-release:acceptance
```

This checks the public release URLs, signed manifest verification, bundle
checksum and packaged installer dry-run from a temporary `MINDORY_HOME`.

Then run the live Docker self-host gate:

```bash
pnpm selfhost:gate
```

For non-Docker release checklist rehearsal, use
`pnpm selfhost:gate -- --dry-run`. The full gate is required before publishing
or announcing a pre-release as usable by others.

Before announcing a public pre-release as usable by others, run the combined
final gate:

```bash
MINDORY_PUBLIC_READY_LIVE=true pnpm public-ready:gate
```

Dry-run mode is part of `pnpm check`. Live mode performs a fresh clone, installs
dependencies, runs `pnpm check`, verifies the public pre-release bootstrap,
runs the live self-host gate, runs the local-model acceptance, runs live
`pnpm ui:e2e`, validates public wording and confirms clean `git status --short`.

## Release Notes Requirements

Generated release notes must include:

- verification summary;
- release artifact list;
- Docker image tags;
- support matrix reference;
- upgrade notes;
- public release checklist;
- changelog excerpt.
