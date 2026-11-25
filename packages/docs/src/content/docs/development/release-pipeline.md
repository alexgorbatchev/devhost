---
title: "Release pipeline"
---

Ship binaries and documentation that describe the same version. A `devhost` release publishes both from one Git tag; a normal push to `main` runs checks without deploying the site.

The guide videos and the promo on the landing page follow a separate, manual track. No workflow records or renders video. A release downloads the videos that were published earlier and checks each against the hash pinned in the repository.

## Pipeline

```mermaid
flowchart TD
    subgraph films["Guide films: by hand, only when a demo changed"]
        audio["just demo audio-guides<br/>generate the narration"]
        record["just demo guides<br/>record and render the films"]
        review{"Films<br/>approved?"}
        upload["just docs publish-media<br/>upload videos, rewrite pins"]
        pins["Commit pins, posters,<br/>captions, guide pages"]
        audio --> record --> review
        review -- yes --> upload --> pins
        review -- no --> record
    end

    media[("GitHub release media<br/>video assets, never replaced")]
    upload --> media

    subgraph merge["Merge"]
        pr["Pull request"]
        ci["ci.yml: just check<br/>verifies the pinned videos"]
        main["main<br/>no docs deploy"]
        pr --> ci --> main
    end
    pins --> pr
    media -. pinned videos .-> ci

    subgraph release["Release"]
        tag["Set the version,<br/>push tag v*"]
        publish["publish.yml job publish<br/>check, build, create release"]
        docs["publish.yml job docs<br/>build the site from the tag"]
        pages["GitHub Pages"]
        tag --> publish --> docs --> pages
    end
    main --> tag
    media -. pinned videos .-> docs
```

The diagram has three stages. The films are made and published by hand, and only when a demo changed. A merge to `main` runs the checks and deploys nothing. A `v*` tag publishes the binaries and then the site. The dotted arrows are the pinned videos, which every docs build downloads from the `media` release.

## How it works

### Binaries

Pushing a tag such as `v0.0.21` starts `.github/workflows/publish.yml`. The workflow fails unless the tag matches the version in `apps/devhost/metadata.json`.

1. **Verification (`verify`)**: The hosted Linux runner installs Playwright Chromium, FFmpeg (including `ffprobe`), unzip, Xvfb, the pinned Rust toolchain, `cargo-llvm-cov`, Caddy, and Chisel, then runs `just check`, `just rust check` (formatting, strict Clippy, and 90% first-party line/function coverage), and Go-oracle inventory verification against the `golang` tag.
2. **Native packaging (`package`)**: A three-host matrix (`ubuntu-24.04`, `ubuntu-24.04-arm`, and `macos-15`) runs `just rust build-release-artifacts` to produce all five archives (`darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`) with Zig/glibc-2.28 and static-musl checks, `THIRD_PARTY_LICENSES.txt`, `SHA256SUMS`, provenance, and matching-host runtime smoke verification.
3. **Publication (`publish`)**: The publish job downloads all five archives, merges and verifies `SHA256SUMS` (`sha256sum -c`), checks every archive's exact four-file layout (`devhost`, `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.txt`), creates the GitHub Release, and uploads all five archives and `SHA256SUMS`.

`just check` still validates the retained Go reference code, including `logpolicy` (`just devhost lint-logging`) and `go test -count=1 ./...`. Every Go test runs afresh because the integration suite observes live processes, ports, and kernel state.

### Documentation site

The `docs` job of the same workflow runs after the release exists. It calls `.github/workflows/docs.yml`, which checks out the tag, builds `packages/docs`, and deploys the result to GitHub Pages. A failed release deploys nothing.

A push to `main` does not deploy the site; documentation merged to `main`, corrections included, is published with the next release.

The `github-pages` environment accepts deployments only from `main` and from tags that match `v*`. The `Deploy docs to GitHub Pages` workflow can also be run by hand, within those limits: a run from a release tag deploys that release's documentation again, unchanged, and a run from `main` deploys everything on `main`, including documentation of unreleased behavior. A branch that holds only a correction cannot be deployed.

### Guide videos

The videos are assets of a GitHub release named `media`, not files in the repository. `packages/docs/demo-media.json` pins each one by name, release asset, SHA-256, and size. Every docs build downloads the pinned videos and rejects a file whose hash differs.

A tag carries its pins. The site built for a release therefore shows the videos that were pinned in the tagged commit, and an asset is never replaced, so an earlier tag still builds with the videos it pinned.

New videos need a Linux host with the recording tools, an operator to approve the coding agent's requests during recording, an ElevenLabs key, and a review of the result. For that reason they are made by hand before the release:

1. `just demo audio-guides` generates the narration of changed lines.
2. `just demo guides` records each guide and renders its film. `just demo record` does the same for the promo.
3. After the films are reviewed, `just docs publish-media` uploads them and rewrites their pins.
4. The pins, posters, captions, and guide pages are committed together.

A change to the interface does not update a video. When a release changes what a guide shows, the film has to be recorded again before the tag is pushed; otherwise the release ships the earlier video beside the new text.
