mod devhost 'apps/devhost/justfile'
mod design 'packages/design/justfile'
mod ui 'packages/devhost-ui/justfile'
mod docs 'packages/docs/justfile'

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

# Ensure Playwright Chromium is available for Storybook workflows
install-browser: ui::install-browser

# Refresh the generated embedded devtools bundle
build-devtools-bundle: devhost::build-devtools-bundle

# Build devhost release tarballs
build-release-artifacts *args:
    just devhost build-release-artifacts {{args}}

# Build the current-platform devhost binary
compile: devhost::compile

# Start the root devhost stack locally
dev: build-devtools-bundle
    DEVHOST_DEV_ASSETS_DIR=apps/devhost/internal/devtools/dist apps/devhost/bin/devhost --manifest devhost.toml

# Start Storybook locally
storybook: ui::storybook

# Start Neovim with the playground project
nvim *args:
    just devhost nvim {{args}}

# Run standalone React Highlight Neovim plugin tests
test-nvim: devhost::test-nvim

# Clean all node_modules directories across the repository
clean:
    find . -name "node_modules" -type d -prune -exec rm -rf '{}' +

# Open the docs site design reference in the default browser
design-docs: design::docs
