#!/usr/bin/env sh
set -eu

MINDORY_HOME="${MINDORY_HOME:-"$HOME/.mindory"}"
MINDORY_RELEASE_CHANNEL="${MINDORY_INSTALL_RELEASE_CHANNEL:-stable}"
MINDORY_RELEASE_MANIFEST_URL="${MINDORY_RELEASE_MANIFEST_URL:-}"
MINDORY_RELEASE_MANIFEST_PATH="${MINDORY_RELEASE_MANIFEST_PATH:-}"
MINDORY_RELEASE_PUBLIC_KEY_PATH="${MINDORY_RELEASE_PUBLIC_KEY_PATH:-}"
MINDORY_RELEASE_PUBLIC_KEY_PEM="${MINDORY_RELEASE_PUBLIC_KEY_PEM:-}"
MINDORY_BOOTSTRAP_VERIFY_ONLY="${MINDORY_BOOTSTRAP_VERIFY_ONLY:-}"
MINDORY_SOURCE_PATH=""

on_interrupt() {
  echo "Mindory bootstrap interrupted. No further install steps will run. Use the repair command after relaunch to inspect staged state." >&2
  exit 130
}

trap on_interrupt INT TERM

usage() {
  cat <<'USAGE'
Mindory installer bootstrap

Usage:
  ./install.sh --manifest-url <url>
  ./install.sh --manifest-path <file>
  ./install.sh --public-key-path <public.pem>
  ./install.sh --source <release-or-source-dir>
  ./install.sh --manifest-path <file> --public-key-path <public.pem> --verify-only

Environment:
  MINDORY_HOME                    Install root. Defaults to ~/.mindory.
  MINDORY_INSTALL_RELEASE_CHANNEL Release channel. Defaults to stable.
  MINDORY_RELEASE_MANIFEST_URL    Manifest URL when --manifest-url is omitted.
  MINDORY_RELEASE_MANIFEST_PATH   Local manifest path when --manifest-path is omitted.
  MINDORY_RELEASE_PUBLIC_KEY_PATH  Trusted release signing public key.
  MINDORY_RELEASE_PUBLIC_KEY_PEM   Trusted release signing public key PEM content.

Manifest format:
  MINDORY_RELEASE_VERSION=1.2.3
  MINDORY_RELEASE_BUNDLE_URL=https://example/mindory.tar.gz
  # Local paths and file:// URLs are also supported for dev/test releases.
  MINDORY_RELEASE_BUNDLE_SHA256=<hex>
  MINDORY_RELEASE_MANIFEST_SIGNATURE_ALGORITHM=RSA-SHA256
  MINDORY_RELEASE_PUBLIC_KEY_SHA256=<hex>
  MINDORY_RELEASE_MANIFEST_SIGNATURE=<base64>
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
    --public-key-path)
      MINDORY_RELEASE_PUBLIC_KEY_PATH="${2:-}"
      shift 2
      ;;
    --source)
      MINDORY_SOURCE_PATH="${2:-}"
      shift 2
      ;;
    --verify-only)
      MINDORY_BOOTSTRAP_VERIFY_ONLY="true"
      shift
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

copy_or_fetch_file() {
  source="$1"
  output="$2"
  case "$source" in
    file://*)
      local_path="$(printf '%s' "${source#file://}" | sed 's/%20/ /g')"
      if [ ! -f "$local_path" ]; then
        echo "Release bundle file does not exist: $local_path" >&2
        exit 1
      fi
      cp "$local_path" "$output"
      ;;
    /*|./*|../*)
      if [ ! -f "$source" ]; then
        echo "Release bundle file does not exist: $source" >&2
        exit 1
      fi
      cp "$source" "$output"
      ;;
    *)
      if [ -f "$source" ]; then
        cp "$source" "$output"
      else
        fetch_file "$source" "$output"
      fi
      ;;
  esac
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

base64_decode() {
  if printf '' | base64 -d >/dev/null 2>&1; then
    base64 -d
  else
    base64 -D
  fi
}

write_unsigned_manifest() {
  manifest="$1"
  output="$2"
  grep -v '^MINDORY_RELEASE_MANIFEST_SIGNATURE=' "$manifest" > "$output"
}

resolve_public_key_file() {
  manifest="$1"
  output="$2"
  if [ -n "$MINDORY_RELEASE_PUBLIC_KEY_PATH" ]; then
    if [ ! -f "$MINDORY_RELEASE_PUBLIC_KEY_PATH" ]; then
      echo "Release public key file does not exist: $MINDORY_RELEASE_PUBLIC_KEY_PATH" >&2
      exit 1
    fi
    cp "$MINDORY_RELEASE_PUBLIC_KEY_PATH" "$output"
    return
  fi
  if [ -n "$MINDORY_RELEASE_PUBLIC_KEY_PEM" ]; then
    printf '%b\n' "$MINDORY_RELEASE_PUBLIC_KEY_PEM" > "$output"
    return
  fi
  if [ -f "$manifest.public.pem" ]; then
    cp "$manifest.public.pem" "$output"
    return
  fi
  echo "Missing trusted release manifest public key. Set MINDORY_RELEASE_PUBLIC_KEY_PATH or MINDORY_RELEASE_PUBLIC_KEY_PEM." >&2
  exit 1
}

verify_manifest_signature() {
  manifest="$1"
  signature_algorithm="$(manifest_value MINDORY_RELEASE_MANIFEST_SIGNATURE_ALGORITHM "$manifest")"
  public_key_sha256="$(manifest_value MINDORY_RELEASE_PUBLIC_KEY_SHA256 "$manifest")"
  manifest_signature="$(manifest_value MINDORY_RELEASE_MANIFEST_SIGNATURE "$manifest")"

  if [ "$signature_algorithm" != "RSA-SHA256" ]; then
    echo "Unsupported or missing release manifest signature algorithm: ${signature_algorithm:-<missing>}." >&2
    exit 1
  fi
  if [ -z "$public_key_sha256" ] || [ -z "$manifest_signature" ]; then
    echo "Release manifest is missing public key hash or signature." >&2
    exit 1
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "Missing openssl for release manifest signature verification." >&2
    exit 1
  fi

  unsigned_manifest="$manifest.unsigned.$$"
  signature_file="$manifest.signature.$$"
  public_key_file="$manifest.public.$$"
  write_unsigned_manifest "$manifest" "$unsigned_manifest"
  resolve_public_key_file "$manifest" "$public_key_file"
  actual_public_key_sha256="$(sha256_file "$public_key_file")"
  if [ "$actual_public_key_sha256" != "$public_key_sha256" ]; then
    rm -f "$unsigned_manifest" "$signature_file" "$public_key_file"
    echo "Release public key SHA-256 mismatch." >&2
    echo "Expected: $public_key_sha256" >&2
    echo "Actual:   $actual_public_key_sha256" >&2
    exit 1
  fi
  if ! printf '%s' "$manifest_signature" | base64_decode > "$signature_file"; then
    rm -f "$unsigned_manifest" "$signature_file" "$public_key_file"
    echo "Release manifest signature is not valid base64." >&2
    exit 1
  fi
  if ! openssl dgst -sha256 -verify "$public_key_file" -signature "$signature_file" "$unsigned_manifest" >/dev/null 2>&1; then
    rm -f "$unsigned_manifest" "$signature_file" "$public_key_file"
    echo "Manifest signature verification failed." >&2
    exit 1
  fi
  rm -f "$unsigned_manifest" "$signature_file" "$public_key_file"
  echo "Verified Mindory release manifest signature."
}

stage_release() {
  bundle_path="$1"
  release_version="$2"
  release_dir="$3"
  staging_dir="$MINDORY_HOME/install/releases/$release_version.staging.$$"
  previous_dir="$MINDORY_HOME/install/releases/$release_version.previous.$$"

  rm -rf "$staging_dir" "$previous_dir"
  mkdir -p "$staging_dir"

  echo "Extracting Mindory release $release_version into a staging directory..."
  if ! tar -xzf "$bundle_path" -C "$staging_dir"; then
    rm -rf "$staging_dir"
    echo "Failed to extract release bundle. The installed release directory was not changed." >&2
    exit 1
  fi

  extracted_root="$staging_dir/mindory-$release_version"
  if [ ! -d "$extracted_root" ]; then
    extracted_root="$staging_dir"
  fi

  if [ -d "$release_dir" ]; then
    mv "$release_dir" "$previous_dir"
  fi

  if ! mv "$extracted_root" "$release_dir"; then
    if [ -d "$previous_dir" ]; then
      mv "$previous_dir" "$release_dir"
    fi
    rm -rf "$staging_dir"
    echo "Failed to promote staged release. Previous release directory was restored when present." >&2
    exit 1
  fi

  rm -rf "$staging_dir" "$previous_dir"
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
  if [ -f "$MINDORY_RELEASE_MANIFEST_PATH.public.pem" ]; then
    cp "$MINDORY_RELEASE_MANIFEST_PATH.public.pem" "$manifest_file.public.pem"
  fi
elif [ -n "$MINDORY_RELEASE_MANIFEST_URL" ]; then
  fetch_file "$MINDORY_RELEASE_MANIFEST_URL" "$manifest_file"
else
  echo "Provide --manifest-url, --manifest-path, --source or MINDORY_RELEASE_MANIFEST_URL." >&2
  exit 2
fi

verify_manifest_signature "$manifest_file"

release_version="$(manifest_value MINDORY_RELEASE_VERSION "$manifest_file")"
bundle_url="$(manifest_value MINDORY_RELEASE_BUNDLE_URL "$manifest_file")"
bundle_sha256="$(manifest_value MINDORY_RELEASE_BUNDLE_SHA256 "$manifest_file")"

if [ -z "$release_version" ] || [ -z "$bundle_url" ] || [ -z "$bundle_sha256" ]; then
  echo "Manifest is missing release version, bundle URL or bundle SHA-256." >&2
  exit 1
fi

bundle_path="$MINDORY_HOME/install/downloads/mindory-$release_version.tar.gz"
release_dir="$MINDORY_HOME/install/releases/$release_version"

copy_or_fetch_file "$bundle_url" "$bundle_path"
actual_sha256="$(sha256_file "$bundle_path")"
if [ "$actual_sha256" != "$bundle_sha256" ]; then
  echo "Checksum mismatch for $bundle_path." >&2
  echo "Expected: $bundle_sha256" >&2
  echo "Actual:   $actual_sha256" >&2
  exit 1
fi

echo "Verified Mindory release bundle checksum for $release_version."
if [ "$MINDORY_BOOTSTRAP_VERIFY_ONLY" = "true" ] || [ "$MINDORY_BOOTSTRAP_VERIFY_ONLY" = "1" ]; then
  echo "Mindory bootstrap verification passed for $release_version."
  exit 0
fi

stage_release "$bundle_path" "$release_version" "$release_dir"

launch_installer "$release_dir"
