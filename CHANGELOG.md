# Changelog

Mindory uses task-scoped changes. Each public release note should reference the
task ids that materially changed behavior, operations, configuration or public
documentation.

## Release Notes Policy

- Keep an `Unreleased` section until a version is tagged.
- Group changes as `Added`, `Changed`, `Fixed`, `Security`, `Deprecated` or
  `Removed`.
- Mention breaking configuration, schema, installer and deployment changes
  explicitly.
- Do not claim unsupported, placeholder or future functionality as supported.
- Include verification context for release candidates, especially `pnpm check`
  and relevant installer or live acceptance commands.
- Never include secrets, token values, private URLs or customer data.

## Unreleased

### Added

- `TASK-70`: public repository hygiene baseline, including license,
  contribution guide, security policy, issue and pull request templates, support
  matrix and repository status documentation.

### Changed

- `TASK-69`: release-style bundle generation and bootstrap checksum/staging
  path are documented and validated.
