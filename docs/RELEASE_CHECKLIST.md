# Release Checklist

This checklist is the public release gate for Mindory tag builds.

## Current Release Target

`v0.1.0` is a historical pre-release and is stale relative to current
`master`. The current public pre-release is `v0.1.1`:
<https://github.com/iwonz/mindory/releases/tag/v0.1.1>.

`v0.1.1` did not overwrite or retag `v0.1.0`; it was published as a new public
pre-release after the `TASK-133` through `TASK-143` supported multimodal
promotion and release preflight work. `TASK-145` through `TASK-147` complete
published-bootstrap and final public-ready gates.

## v0.1.1 Local Preflight

`TASK-143` records the local preflight command set for the `v0.1.1` release
candidate:

```bash
pnpm release:bundle -- --version 0.1.1 --url-base https://github.com/iwonz/mindory/releases/download/v0.1.1
pnpm release:notes -- --version 0.1.1 --tag v0.1.1 --image ghcr.io/iwonz/mindory:0.1.1 --sha-image ghcr.io/iwonz/mindory:<git-sha>
pnpm release:validate
pnpm check
```

The generated bundle preflight must create `mindory-0.1.1.tar.gz`,
`mindory-0.1.1.manifest.env`, `mindory-0.1.1.manifest.env.public.pem`,
`mindory-0.1.1.sha256` and `mindory-0.1.1.release-notes.md` under
`dist/releases/` without modifying or overwriting historical `v0.1.0` release
assets.

Latest local preflight result: `TASK-143` passed on 2026-05-24 with an
ephemeral dev/test signing key. The generated manifest pointed at
`https://github.com/iwonz/mindory/releases/download/v0.1.1/mindory-0.1.1.tar.gz`,
included an RSA-SHA256 signature and matched the generated `.sha256` checksum.
This was a local preflight only; publication was completed in `TASK-144`.

Latest publication result: `TASK-144` passed on 2026-05-24. The tag
`v0.1.1` points at master commit `424ab6c71abefb7e5af7cb7d02b6d7163bf51f73`,
the release workflow finished successfully, and the public pre-release is
available at <https://github.com/iwonz/mindory/releases/tag/v0.1.1>. Attached
assets are `mindory-0.1.1.tar.gz`, `mindory-0.1.1.manifest.env`,
`mindory-0.1.1.manifest.env.public.pem`, `mindory-0.1.1.sha256` and
`mindory-0.1.1.release-notes.md`. Published GHCR tags are `0.1.1` and
`424ab6c71abe`.

Latest published bootstrap result: `TASK-145` passed on 2026-05-24.
`MINDORY_PUBLISHED_RELEASE_ACCEPTANCE_LIVE=true pnpm published-release:acceptance`
downloaded the public `v0.1.1` manifest, bundle, public key and `.sha256`
assets, verified checksum entries for all three release assets, verified the
signed manifest through `install.sh --verify-only` and completed the packaged
installer `plan` dry-run from a temporary `MINDORY_HOME`.

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
- `MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true pnpm local-model:acceptance`.
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

Then run the supported multimodal local-model gate:

```bash
MINDORY_LOCAL_MODEL_ACCEPTANCE_LIVE=true pnpm local-model:acceptance
```

This checks deterministic MVP processing, scanned PDF OCR, image
OCR/caption/object/vector contracts, audio ASR transcript segments, video
keyframes through image handlers, face observations/identities, image/audio
generation smoke, source refs, jobs, unified search, worker model-operation
metrics and the focused OCR, ASR, image semantics and face runner gates.

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
