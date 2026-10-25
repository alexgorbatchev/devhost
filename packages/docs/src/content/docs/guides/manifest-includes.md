---
title: "Monorepos and includes"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/manifest-includes.webp" aria-label="manifest includes demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/manifest-includes.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/manifest-includes.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/manifest-includes.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

In a monorepo, each package can keep its services in its own `devhost.toml`, next to its code. A root manifest pulls them together with `includes`, and `devhost start` from the root runs them as one stack.

## Include package manifests

```toml
# devhost.toml at the repository root
name = "acme"
includes = ["apps/*/devhost.toml", "packages/*/devhost.toml"]
```

```toml
# apps/api/devhost.toml
[services.api]
command = ["bun", "run", "dev"]
port = "auto"
watch = ["src/"]
```

`includes` takes paths or glob patterns, relative to the root manifest. Included manifests can include others in turn.

- Each included manifest contributes its `[services.*]` and `[groups]`. Everything else, such as `name` and `[devtools]`, comes from the root manifest only.
- Service names and group names must be unique across all the files. A duplicate fails with a conflict error.
- `dependsOn` and groups can refer to services from any included file.
- Matching files are merged in alphabetical order, so the fallback primary service is always the same.
- A file that includes itself, directly or through another file, is read only once.
- `{{ env.NAME }}` placeholders work in every included file.

## Paths in included manifests

Paths in an included manifest are relative to that manifest's own directory, as if it were run on its own:

- A service without `cwd` runs in its manifest's directory, `apps/api` above.
- A relative `cwd` resolves from there too, and relative `watch` paths from the service's `cwd`, so `watch = ["src/"]` watches `apps/api/src/`.

## Start one app of the monorepo

The merged stack holds every service of every package, usually more than one task needs. From the root, name what you are working on:

```bash
devhost start web api
```

devhost starts those services, what they reach through `dependsOn` (even across files), and services marked `alwaysStart`. Each package can define its own [group](../stack-lifecycle/#named-service-groups) next to its services, so the root needs nothing but `includes`. See [Start part of a stack](../stack-lifecycle/#start-part-of-a-stack).

## Run a package on its own

An included manifest is a complete manifest. Run `devhost start` in its directory and it starts as a standalone stack, with its own `name` and settings. Inside the root's stack, those settings are ignored and the root's apply.

A manifest file belongs to one running stack at a time. A standalone package stack and a root stack that includes the same file cannot run together, even when they start different services; the second fails with an error naming the file, the owner's PID, and the `devhost stop --manifest` command for it. Stop one before starting the other.

## Changes while the stack runs

Saving the root or any included manifest [hot-reloads](../../stacks/hot-reload/) the merged stack. Adding or deleting a file that matches an `includes` pattern adds or removes its services. An include that another stack is using rejects the reload, and the stack keeps running as it was.
