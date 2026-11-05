#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p -- "$ROOT/.tmp"
FIXTURE=$(mktemp -d "$ROOT/.tmp/runner-regression.XXXXXX")
RUNNER_PID=
CHILD_PID=
RUN_DIRECTORY=

cleanup() {
  local result=$? state attempt
  trap - EXIT
  trap '' HUP INT TERM
  if [[ -n "$RUNNER_PID" && -z "$CHILD_PID" ]]; then
    for ((attempt = 0; attempt < 100; attempt++)); do
      [[ -f "$FIXTURE/ready" ]] && break
      /bin/kill -0 "$RUNNER_PID" 2>/dev/null || break
      sleep 0.05
    done
    if [[ -f "$FIXTURE/ready" ]]; then
      { read -r CHILD_PID; read -r RUN_DIRECTORY; } < "$FIXTURE/ready"
    fi
  fi
  if [[ -n "$CHILD_PID" ]]; then
    /bin/kill -TERM -- "-$CHILD_PID" 2>/dev/null || true
    for ((attempt = 0; attempt < 50; attempt++)); do
      state=$(ps -p "$CHILD_PID" -o stat=) || break
      [[ "$state" == Z* ]] && break
      sleep 0.1
    done
    /bin/kill -KILL -- "-$CHILD_PID" 2>/dev/null || true
  fi
  if [[ -n "$RUNNER_PID" ]]; then
    /bin/kill -KILL "$RUNNER_PID" 2>/dev/null || true
    wait "$RUNNER_PID" 2>/dev/null || true
  fi
  if [[ -n "$CHILD_PID" ]]; then
    for ((attempt = 0; attempt < 50; attempt++)); do
      state=$(ps -p "$CHILD_PID" -o stat=) || { state=; break; }
      [[ "$state" == Z* ]] && break
      sleep 0.1
    done
    if [[ -n "$state" && "$state" != Z* ]]; then
      printf 'ERROR: fixture child survived; preserving %s and %s\n' "$FIXTURE" "$RUN_DIRECTORY" >&2
      exit 1
    fi
  fi
  [[ -z "$RUN_DIRECTORY" || ! -d "$RUN_DIRECTORY" ]] || rm -r -- "$RUN_DIRECTORY"
  rm -r -- "$FIXTURE"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Fail signal delivery while retaining real processes and real ps inspection.
# This exercises a surviving child without requiring uninterruptible kernel I/O.
printf 'kill() { return 1; }\n' > "$FIXTURE/no-signal.bash"
BASH_ENV="$FIXTURE/no-signal.bash" bash "$ROOT/test-support/runTests.sh" \
  bash -c 'printf "%s\n%s\n" "$$" "$TMPDIR" > "$1.pending"; mv -- "$1.pending" "$1"; exec sleep 60' \
  bash "$FIXTURE/ready" > "$FIXTURE/output" 2>&1 &
RUNNER_PID=$!
for ((attempt = 0; attempt < 100; attempt++)); do
  [[ -s "$FIXTURE/ready" ]] && break
  sleep 0.05
done
[[ -s "$FIXTURE/ready" ]] || { printf 'ERROR: child did not become ready\n' >&2; exit 1; }
{
  read -r CHILD_PID
  read -r RUN_DIRECTORY
} < "$FIXTURE/ready"
[[ "$CHILD_PID" =~ ^[0-9]+$ && "$RUN_DIRECTORY" == /tmp/dht.* ]]
/bin/kill -TERM "$RUNNER_PID"

# A failed shutdown must finish before the still-running child's 60-second sleep.
for ((attempt = 0; attempt < 300; attempt++)); do
  /bin/kill -0 "$RUNNER_PID" 2>/dev/null || break
  sleep 0.1
done
if /bin/kill -0 "$RUNNER_PID" 2>/dev/null; then
  printf 'ERROR: runner blocked after its shutdown deadline\n' >&2
  exit 1
fi
result=0
wait "$RUNNER_PID" || result=$?
RUNNER_PID=
[[ "$result" == 1 ]]
[[ -d "$RUN_DIRECTORY" ]]
/bin/kill -0 "$CHILD_PID"
printf 'ERROR: test processes survived shutdown; preserving %s\n' "$RUN_DIRECTORY" > "$FIXTURE/expected"
cmp "$FIXTURE/expected" "$FIXTURE/output"
printf 'PASS: failed shutdown returns without waiting and preserves owned scratch\n'
