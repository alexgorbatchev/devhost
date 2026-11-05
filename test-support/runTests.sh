#!/usr/bin/env bash
set -euo pipefail

# Use a short command-owned path: Chromium's Unix sockets cannot use deep checkouts.
RUN_DIRECTORY=$(mktemp -d "/tmp/dht.XXXXXX")
TEST_PID=

# The inherited marker finds detached helpers even after a test panic reparents
# them. Never print or retain the process environments used for that inspection.
live_groups() {
  ps "${PS_ENVIRONMENT[@]}" -o pid= -o ppid= -o pgid= -o stat= -o command= |
    awk -v root="$TEST_PID" -v caller="$OWN_GROUP" -v previous="$1" '
      BEGIN {
        split(previous, ids)
        for (id in ids) known[ids[id]] = 1
        marker = "DEVHOST_TEST_RUN_ID=" ENVIRON["DEVHOST_TEST_RUN_ID"]
      }
      $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
        parent[$1] = $2; group[$1] = $3; state[$1] = $4
        for (field = 5; field <= NF; field++) {
          if ($field == marker) owned[$1] = 1
        }
      }
      END {
        owned[root] = 1
        do {
          changed = 0
          for (pid in parent) {
            if (!owned[pid] && owned[parent[pid]]) {
              owned[pid] = 1
              changed = 1
            }
          }
        } while (changed)
        for (pid in parent) {
          if ((owned[pid] || known[group[pid]]) && state[pid] !~ /^Z/ && group[pid] > 1 && group[pid] != caller)
            groups[group[pid]] = 1
        }
        for (id in groups) print id
      }
    '
}

cleanup() {
  local result=$? groups="" group attempt signal sent
  trap - EXIT
  trap '' HUP INT TERM PIPE
  set +m
  if [[ -n "$TEST_PID" ]]; then
    for signal in TERM KILL; do
      sent=" "
      for ((attempt = 0; attempt < 50; attempt++)); do
        groups=$(live_groups "$groups") || {
          printf 'ERROR: could not inspect test processes; preserving %s\n' "$RUN_DIRECTORY" >&2
          kill -TERM -- "-$TEST_PID" 2>/dev/null || true
          exit 1
        }
        [[ -n "$groups" ]] || break
        for group in $groups; do
          if [[ "$sent" != *" $group "* ]]; then
            kill -"$signal" -- "-$group" 2>/dev/null || true
            sent+="$group "
          fi
        done
        sleep 0.1
      done
      [[ -n "$groups" ]] || break
    done
    if [[ -n "$groups" ]]; then
      printf 'ERROR: test processes survived shutdown; preserving %s\n' "$RUN_DIRECTORY" >&2
      exit 1
    fi
    wait "$TEST_PID" 2>/dev/null || true
  fi
  rm -rf -- "$RUN_DIRECTORY" || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

OWN_GROUP=$(ps -p "$$" -o pgid= | tr -d ' ')
USER_ID=$(id -u)
PS_ENVIRONMENT=(eww -u "$USER_ID")
if [[ $(uname -s) == Darwin ]]; then PS_ENVIRONMENT=(-Eww -x -U "$USER_ID"); fi

export TMPDIR="$RUN_DIRECTORY"
export GOTMPDIR="$RUN_DIRECTORY"
export DEVHOST_TEST_RUN_ID="$RUN_DIRECTORY"
export CHROME_CONFIG_HOME="$RUN_DIRECTORY/chrome-config"
export XDG_RUNTIME_DIR="$RUN_DIRECTORY/runtime"
export PULSE_RUNTIME_PATH="$XDG_RUNTIME_DIR/pulse"
mkdir -m 700 -- "$XDG_RUNTIME_DIR"
set -m
"$@" &
TEST_PID=$!
wait "$TEST_PID"
