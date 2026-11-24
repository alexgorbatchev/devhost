#!/usr/bin/env bash
set -euo pipefail

# Go uses Security.framework on macOS rather than SSL_CERT_FILE. This fixture
# belongs only to disposable hosted runners, never a contributor's trust store.
if [[ "$(uname -s)" != Darwin || "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted ]]; then
  echo 'The health-check trust fixture requires a disposable GitHub-hosted macOS runner.' >&2
  exit 1
fi

cleanup() {
  local fixture_dir="${DEVHOST_HEALTH_TRUST_DIR:-}"
  [[ -n "$fixture_dir" ]] || return 0
  if [[ "$fixture_dir" != "$RUNNER_TEMP"/devhost-health-trust.* || -L "$fixture_dir" ]]; then
    echo 'Refusing an unowned health-check trust directory.' >&2
    return 1
  fi
  [[ -d "$fixture_dir" ]] || return 0
  local failed=0
  if [[ -f "$fixture_dir/trust-attempted" ]]; then
    local fingerprint
    fingerprint="$(openssl x509 -in "$fixture_dir/root.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
    if [[ ! -f "$fixture_dir/certificate-removed" ]]; then
      printf 'Removing health fixture certificate and trust: %s\n' "$fingerprint"
      # Root's -t removes both user and admin trust before deleting this item.
      if sudo -n security delete-certificate -t -Z "$fingerprint" /Library/Keychains/System.keychain; then
        touch "$fixture_dir/certificate-removed"
      else
        failed=1
      fi
    fi
  fi
  [[ "$failed" == 0 ]] || return 1
  rm -rf -- "$fixture_dir"
}

case "${1:-}" in
  prepare)
    umask 077
    DEVHOST_HEALTH_TRUST_DIR="$(mktemp -d "$RUNNER_TEMP/devhost-health-trust.XXXXXX")"
    export DEVHOST_HEALTH_TRUST_DIR
    echo "DEVHOST_HEALTH_TRUST_DIR=$DEVHOST_HEALTH_TRUST_DIR" >> "$GITHUB_ENV"
    trap 'result=$?; if [[ "$result" != 0 ]]; then cleanup || echo "Health trust cleanup failed; the final cleanup step will retry." >&2; fi; exit "$result"' EXIT
    fixture_dir="$DEVHOST_HEALTH_TRUST_DIR"
    printf '%s\n' '[req]' 'prompt=no' 'distinguished_name=subject' 'x509_extensions=root' '[subject]' 'CN=Devhost ephemeral health fixture' '[root]' 'basicConstraints=critical,CA:TRUE' 'keyUsage=critical,keyCertSign,cRLSign' > "$fixture_dir/root.cnf"
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -config "$fixture_dir/root.cnf" -keyout "$fixture_dir/root.key" -out "$fixture_dir/root.pem"
    openssl req -new -newkey rsa:2048 -nodes -subj '/CN=localhost' -keyout "$fixture_dir/server.key" -out "$fixture_dir/server.csr"
    printf '%s\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' 'subjectAltName=IP:127.0.0.1' > "$fixture_dir/server.ext"
    openssl x509 -req -in "$fixture_dir/server.csr" -CA "$fixture_dir/root.pem" -CAkey "$fixture_dir/root.key" -CAcreateserial -days 1 -extfile "$fixture_dir/server.ext" -out "$fixture_dir/server.pem"
    touch "$fixture_dir/trust-attempted"
    sudo -n security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$fixture_dir/root.pem"
    ;;
  cleanup) cleanup ;;
  *) echo 'Expected prepare or cleanup.' >&2; exit 1 ;;
esac
