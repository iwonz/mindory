# Security Policy

Mindory is currently a self-hosted local MVP. The runtime security model is
documented in `docs/SECURITY.md`; this root policy covers public vulnerability
handling for the repository.

## Supported Versions

| Version or branch | Security support |
| --- | --- |
| `master` | Best-effort security fixes before public release tags. |
| Release tags | Future support policy after the first public release. |
| Forks and private deployments | Maintained by their operators. |

## Reporting A Vulnerability

Do not report suspected vulnerabilities through public GitHub issues.

Use GitHub private vulnerability reporting or a private security advisory for
this repository when available. If that channel is unavailable, contact the
repository owner through a private maintainer channel and include:

- affected commit, tag or release bundle;
- deployment mode and relevant configuration, with secrets redacted;
- clear reproduction steps;
- expected impact;
- logs or request examples with tokens, keys and personal data removed.

## Disclosure Expectations

Please allow maintainers reasonable time to triage and prepare a fix before
public disclosure. The project will document confirmed fixes in `CHANGELOG.md`
or release notes once a public release process exists.

## Secret Handling

Never attach real `.env` files, bearer tokens, OAuth tokens, API keys, database
URLs or storage credentials to issues or pull requests. Generated credentials
belong under `MINDORY_HOME/config` with local filesystem protections.
