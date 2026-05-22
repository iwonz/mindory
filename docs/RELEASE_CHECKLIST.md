# Release Checklist

This checklist is the public release gate for Mindory tag builds.

## Required Repository Secrets

- `MINDORY_RELEASE_SIGNING_PRIVATE_KEY_PEM`: RSA private key used only by the
  release workflow to sign release manifests.
- `GITHUB_TOKEN`: GitHub-provided token used by Actions for draft release
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
- `pnpm release:validate`.
- `pnpm selfhost:acceptance`.
- Signed manifest verification through `install.sh` or `install.ps1`
  verify-only mode for the generated manifest.

## Draft Release Contents

- `mindory-<version>.tar.gz`.
- `mindory-<version>.manifest.env`.
- `mindory-<version>.manifest.env.public.pem`.
- `mindory-<version>.sha256`.
- `mindory-<version>.release-notes.md`.

## Release Notes Requirements

Generated release notes must include:

- verification summary;
- release artifact list;
- Docker image tags;
- support matrix reference;
- upgrade notes;
- public release checklist;
- changelog excerpt.
