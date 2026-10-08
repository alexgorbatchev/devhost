mod devhost 'apps/devhost/justfile'
mod design 'packages/design/justfile'
mod ui 'packages/devhost-ui/justfile'
mod docs 'packages/docs/justfile'
mod demo 'packages/devhost-ui/scripts/demo/justfile'

# Run devhost from source in the calling directory
run *args: (devhost::run args)

# Run devhost from source in the calling directory with agent-facing output
run-ai *args: (devhost::run-ai args)

# Run every workspace test suite
test:
    just devhost test
    just design test
    just ui test
    just docs test

# Run full repo formatting, policy, and package checks
check:
    @echo 'Running formatting and policy checks...'
    bun typescript-ai-policy check
    @echo 'Formatting and policy checks passed successfully!'
    just devhost check
    just design check
    just ui check
    just docs check

# Human-only repo-wide formatting command for explicit manual cleanup
fix:
    bun --bun oxfmt --write .
    gofmt -w apps/devhost

# Build and replace the devhost payload used by the dotfiles shim
dev-bootstrap $dotfiles_dir=(env_var("HOME") / ".dotfiles"):
    revision="$(git rev-parse --short HEAD)" && just --justfile apps/devhost/justfile --set build-version "999.0.0-dev.$revision" compile
    bun run ./apps/devhost/scripts/devBootstrap.ts

# Start the root devhost stack locally
dev: devhost::build-devtools-bundle
    DEVHOST_DEV_SOURCE_DIR=. apps/devhost/bin/devhost start --manifest devhost.toml

# Clean all node_modules directories across the repository
clean:
    find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
