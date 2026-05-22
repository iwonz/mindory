#!/usr/bin/env sh
set -eu

MINDORY_HOME="${MINDORY_HOME:-"$HOME/.mindory"}"
MINDORY_RELEASE_CHANNEL="${MINDORY_INSTALL_RELEASE_CHANNEL:-stable}"
MINDORY_RELEASE_MANIFEST_URL="${MINDORY_RELEASE_MANIFEST_URL:-}"
MINDORY_RELEASE_MANIFEST_PATH="${MINDORY_RELEASE_MANIFEST_PATH:-}"
MINDORY_SOURCE_PATH=""

usage() {
  cat <<'USAGE'
Mindory installer bootstrap

Usage:
  ./install.sh --manifest-url <url>
  ./install.sh --manifest-path <file>
  ./install.sh --source <release-or-source-dir>

Environment:
  MINDORY_HOME                    Install root. Defaults to ~/.mindory.
  MINDORY_INSTALL_RELEASE_CHANNEL Release channel. Defaults to stable.
  MINDORY_RELEASE_MANIFEST_URL    Manifest URL when --manifest-url is omitted.
  MINDORY_RELEASE_MANIFEST_PATH   Local manifest path when --manifest-path is omitted.

Manifest format:
  MINDORY_RELEASE_VERSION=1.2.3
  MINDORY_RELEASE_BUNDLE_URL=https://example/mindory.tar.gz
  MINDORY_RELEASE_BUNDLE_SHA256=<hex>
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --manifest-url)
      MINDORY_RELEASE_MANIFEST_URL="${2:-}"
      shift 2
      ;;
    --manifest-path)
      MINDORY_RELEASE_MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    --source)
      MINDORY_SOURCE_PATH="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

fetch_file() {
  url="$1"
  output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
  else
    echo "Missing curl or wget for release download." >&2
    exit 1
  fi
}

sha256_file() {
  target="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}'
  else
    echo "Missing sha256sum or shasum for checksum verification." >&2
    exit 1
  fi
}

manifest_value() {
  key="$1"
  file="$2"
  grep "^$key=" "$file" | tail -n 1 | cut -d '=' -f 2-
}

launch_installer() {
  release_dir="$1"
  if [ -x "$release_dir/bin/mindory-installer" ]; then
    exec "$release_dir/bin/mindory-installer" wizard
  fi
  if command -v node >/dev/null 2>&1 && [ -f "$release_dir/packages/installer/dist/cli.js" ]; then
    exec node "$release_dir/packages/installer/dist/cli.js" wizard
  fi
  if command -v pnpm >/dev/null 2>&1 && [ -f "$release_dir/package.json" ]; then
    cd "$release_dir"
    pnpm --filter @mindory/installer typecheck
    exec node packages/installer/dist/cli.js wizard
  fi
  echo "Could not find a Mindory installer entrypoint in $release_dir." >&2
  exit 1
}

umask 077
mkdir -p "$MINDORY_HOME/install/downloads" "$MINDORY_HOME/install/releases" "$MINDORY_HOME/config" "$MINDORY_HOME/logs"

if [ -n "$MINDORY_SOURCE_PATH" ]; then
  launch_installer "$MINDORY_SOURCE_PATH"
fi

need_command tar

manifest_file="$MINDORY_HOME/install/downloads/manifest-$MINDORY_RELEASE_CHANNEL.env"
if [ -n "$MINDORY_RELEASE_MANIFEST_PATH" ]; then
  cp "$MINDORY_RELEASE_MANIFEST_PATH" "$manifest_file"
elif [ -n "$MINDORY_RELEASE_MANIFEST_URL" ]; then
  fetch_file "$MINDORY_RELEASE_MANIFEST_URL" "$manifest_file"
else
  echo "Provide --manifest-url, --manifest-path, --source or MINDORY_RELEASE_MANIFEST_URL." >&2
  exit 2
fi

release_version="$(manifest_value MINDORY_RELEASE_VERSION "$manifest_file")"
bundle_url="$(manifest_value MINDORY_RELEASE_BUNDLE_URL "$manifest_file")"
bundle_sha256="$(manifest_value MINDORY_RELEASE_BUNDLE_SHA256 "$manifest_file")"

if [ -z "$release_version" ] || [ -z "$bundle_url" ] || [ -z "$bundle_sha256" ]; then
  echo "Manifest is missing release version, bundle URL or bundle SHA-256." >&2
  exit 1
fi

bundle_path="$MINDORY_HOME/install/downloads/mindory-$release_version.tar.gz"
release_dir="$MINDORY_HOME/install/releases/$release_version"

fetch_file "$bundle_url" "$bundle_path"
actual_sha256="$(sha256_file "$bundle_path")"
if [ "$actual_sha256" != "$bundle_sha256" ]; then
  echo "Checksum mismatch for $bundle_path." >&2
  echo "Expected: $bundle_sha256" >&2
  echo "Actual:   $actual_sha256" >&2
  exit 1
fi

mkdir -p "$release_dir"
tar -xzf "$bundle_path" -C "$release_dir"

launch_installer "$release_dir"
