mod devhost 'apps/devhost/justfile'
mod rust 'apps/devhost/rust/justfile'
mod design 'packages/design/justfile'
mod ui 'packages/devhost-ui/justfile'
mod docs 'packages/docs/justfile'
mod demo 'packages/devhost-ui/scripts/demo/justfile'
mod playground-backend 'packages/playground/backend/justfile'
mod playground-frontend 'packages/playground/frontend/justfile'
mod archify 'docs/internal/architecture/justfile'

# Run devhost from source in the calling directory
cli *args: (rust::run args)

# Run devhost from source in the calling directory with agent-facing output
run-ai *args: (rust::run-ai args)

# Run every workspace test suite
test:
    bash test-support/runTests.test.sh
    just devhost test
    just design test
    just ui test
    just docs test
    just playground-frontend test

# Run full repo formatting, policy, and package checks
check:
    @echo 'Running formatting and policy checks...'
    bun typescript-ai-policy check
    @echo 'Formatting and policy checks passed successfully!'
    bash test-support/runTests.test.sh
    just devhost check
    just design check
    just ui check
    just docs check
    just playground-frontend check

# Human-only repo-wide formatting command for explicit manual cleanup
fix:
    bun --bun oxfmt --write .
    gofmt -w apps/devhost
    just rust fmt

# Build and register a protected devhost development override
dev-bootstrap $dotfiles_dir=(env_var("HOME") / ".dotfiles"):
    just devhost build-devtools-bundle
    base="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || echo v0.0.0)" && revision="$(git rev-parse --short HEAD)" && DEVHOST_BUILD_VERSION="999.0.0-dev--${base#v}+$revision" DEVHOST_BUILD_SOURCE_DIRECTORY="{{ justfile_directory() }}" cargo build --manifest-path apps/devhost/rust/Cargo.toml --release --locked --bin devhost
    bun run ./apps/devhost/scripts/devBootstrap.ts

# Start the root devhost stack using machine routing
run:
    just rust run start --detach --manifest devhost.toml

# Clean all node_modules directories across the repository
clean:
    find . -name "node_modules" -type d -prune -exec rm -rf '{}' +

# Prepare dependencies for local development.
setup:
    bun install --frozen-lockfile
    just devhost setup
