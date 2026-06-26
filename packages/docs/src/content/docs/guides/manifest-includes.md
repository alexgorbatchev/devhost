---
title: "Manifest Includes"
sidebar:
  order: 8
---

`devhost` supports splitting stack configurations across multiple files using the `includes` key. This is particularly valuable in monorepo environments, allowing each sub-application or workspace package to maintain and control its own service definitions locally without cluttering a single massive root-level manifest.

## Usage

In your root-level `devhost.toml`, define the stack `name`, any global settings, and specify the `includes` key with a list of file paths or glob patterns (resolved relative to the directory of the root manifest):

```toml
# root devhost.toml
name = "my-monorepo-stack"

includes = [
  "packages/*/devhost.toml",
  "apps/*/devhost.toml"
]
```

Each matching sub-manifest is parsed, prepared, and merged recursively into the main stack.

## Sub-Manifest Solo Runs & Override Protection

To support local solo development, a sub-manifest (such as `packages/app1/devhost.toml`) can define a complete standalone stack configuration (including its own `name`, local `caddy` port mappings, or `devtools` overlays).

When a sub-manifest is run solo (by running `devhost` from its local package directory), it runs as a first-class standalone stack.

However, when included in a root manifest:

1. Only local services (`services`) and annotation actions (`annotation.actions`) are extracted and merged.
2. Root global settings (like stack name, Caddy proxy front door, and devtools toggle settings) remain authoritative and **cannot be overridden** by the sub-manifests.

This enables you to use the exact same configuration files both for individual sub-application solo runs and as modular components of a large multi-service stack.

## Path Resolution & Working Directory Defaults

Normally, paths in `devhost` are resolved relative to the manifest directory. To keep workspace configurations completely self-contained, `devhost` automatically applies the following rules during merging:

- **Relative Path Rewriting**: Any relative `cwd` or `watch` folder defined in a sub-manifest is automatically resolved and rewritten relative to the **root manifest's directory** before spawning or tracking.
- **Default Working Directory**: If a service in a sub-manifest omits `cwd`, it automatically defaults to the directory of the sub-manifest where that service was defined, rather than defaulting to the root manifest directory.

### Example Path Translation

If the root manifest is at `/project/devhost.toml` and includes `/project/packages/api/devhost.toml`:

```toml
# /project/packages/api/devhost.toml
[services.api]
command = ["bun", "run", "dev"]
# cwd is omitted, so it defaults to "." (the app directory)
watch = ["src/"]
```

During merging, `devhost` translates the paths relative to the root manifest directory `/project`:

- `cwd` becomes `packages/api`
- `watch` becomes `["packages/api/src/"]`

## Rules and Constraints

To ensure configuration robustness and prevent common monorepo pitfalls, `devhost` enforces these rules at validation time:

- **Unique Service Names**: Service names must be unique across all merged manifests. If two manifests define the same service name, `devhost` aborts with a clear conflict error.
- **Deterministic Order**: Glob pattern matches are sorted alphabetically prior to merging, ensuring that the service load order (and fallback primary service selection) remains 100% deterministic across all filesystems and operating systems.
- **Cyclic Reference Protection**: If Manifest A includes Manifest B, which includes Manifest A, `devhost` safely detects the cyclic reference and skips already-visited files without infinite recursion.
- **Shared Variables**: Environment variable interpolation (e.g. `{{ env.NAME }}`) runs on the fully merged map, enabling system variables to propagate cleanly to all sub-manifest definitions.
