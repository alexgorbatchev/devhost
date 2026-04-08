# devhost multi-project correctness to-do

## Product decisions locked

- Shared global managed Caddy by default
- Manual shared Caddy only
- Remove `autostop` completely
- Hostname ownership is exclusive across projects
- Same hostname on different paths is allowed within one stack
- Reserve fixed bind `host:port` globally across devhost processes
- Keep `port = "auto"` best-effort for v1
- Retry automatically on clear auto-port bind collisions
- Shared 404 page lists all active hostnames globally

## Implementation tasks

### 1. Remove `autostop` from the product
- [x] Remove `[caddy].autostop` from manifest types and validation
- [x] Remove `autostop` handling from stack startup
- [x] Remove autostop lock/session implementation and dead code under `src/caddy/`
- [x] Remove autostop-specific tests
- [x] Make stack startup always require an already-running shared managed Caddy admin API
- [x] Fail clearly if manifest still contains `[caddy].autostop`

### 2. Redefine route ownership correctly
- [ ] Introduce an explicit route ownership model that distinguishes:
  - public hostname ownership across projects
  - per-path routing within a single manifest
- [ ] Stop keying shared route registrations by `host + serviceName`
- [ ] Add a hostname ownership claim format that can detect cross-project conflicts reliably
- [ ] Allow multiple services in one manifest to share a hostname only when their public paths do not overlap
- [ ] Reject any attempt by a different manifest/process to claim a hostname that is already owned
- [ ] Normalize public paths before comparison and persistence
- [ ] Ensure route cleanup releases hostname ownership only when the owning stack exits

### 3. Fix route file generation for same-host multi-path services in one stack
- [ ] Stop generating multiple independent Caddy site blocks for the same hostname
- [ ] Generate one hostname-level route definition that contains all path handlers for that hostname within the stack
- [ ] Define deterministic handler ordering for overlapping-safe path matching inside one host
- [ ] Keep devtools document injection behavior working for root-mounted services
- [ ] Keep non-root path routing working without relying on duplicate host blocks

### 4. Add cross-process fixed-port reservations
- [ ] Introduce shared reservation files/state for explicit fixed bind `host:port`
- [ ] Claim fixed bind ports before spawning services
- [ ] Fail fast with a clear error when another live devhost process already owns the same fixed bind socket
- [ ] Clean up stale fixed-port claims from dead processes
- [ ] Release fixed-port claims on shutdown and startup failure
- [ ] Keep per-manifest duplicate fixed-port validation as an early local check

### 5. Keep `auto` ports best-effort, but harden failure handling
- [ ] Keep current best-effort `get-port` allocation for `port = "auto"`
- [ ] Detect clear bind-collision failures for auto-port services
- [ ] Re-resolve a new auto port and retry startup automatically for those services
- [ ] Bound retries and surface a deterministic final failure message if retries are exhausted
- [ ] Ensure retried services update health checks and injected `PORT` consistently

### 6. Update startup/shutdown orchestration
- [ ] Reorder startup so shared claims are acquired before child processes are spawned
- [ ] Ensure partial-start failures unwind hostname claims, route files, and fixed-port claims correctly
- [ ] Ensure shutdown removes routes, hostname claims, and fixed-port claims in the correct order
- [ ] Preserve stale-registration cleanup for dead processes

### 7. Update manifest validation rules
- [x] Remove `autostop` from documented manifest schema
- [ ] Validate hostname uniqueness across services only when required by the new single-manifest path-sharing rules
- [ ] Add exact path-overlap validation for services sharing a hostname within one manifest
- [ ] Keep routed-service requirements for `host`, `port`, and health constraints intact
- [ ] Keep bind-host validation intact

### 8. Update docs and examples
- [ ] Rewrite `packages/devhost/README.md` to describe shared-global manual Caddy lifecycle only
- [ ] Document that multiple projects can share the global Caddy instance
- [ ] Document that hostname ownership is exclusive across projects
- [ ] Document that one manifest may mount multiple services under one hostname on distinct paths
- [ ] Document global fixed-port reservation behavior
- [ ] Document that `auto` ports are best-effort in v1 and can retry on bind races
- [x] Update `packages/devhost/devhost.example.toml` to remove `autostop`
- [x] Update any help text and contributor docs that still mention autostop

### 9. Expand test coverage
- [ ] Add manifest-validation tests for same-host multi-path services in one stack
- [ ] Add manifest-validation tests for invalid overlapping path configurations in one stack
- [ ] Add route ownership tests for cross-project hostname conflicts
- [ ] Add route generation tests for one hostname with multiple path handlers
- [ ] Add fixed-port claim tests across simulated processes
- [ ] Add startup cleanup tests for partial failures after claims are acquired
- [ ] Add auto-port retry tests for bind-collision recovery
- [x] Remove or rewrite tests that assert autostop behavior

### 10. Final validation
- [x] Run targeted package tests for changed areas
- [x] Run `bun test` in `packages/devhost`
- [x] Run `bun run check` in `packages/devhost`
- [ ] Verify README and example manifest match actual behavior exactly

## Definition of done

- `autostop` no longer exists in code, docs, or examples
- Multiple devhost projects can coexist against one shared manual Caddy instance
- Different projects cannot claim the same hostname
- One manifest can serve multiple non-overlapping paths under the same hostname
- Fixed bind-port conflicts fail before service spawn
- Auto-port bind races retry automatically with bounded retries
- Shared 404 page lists all active hostnames correctly
- Tests and docs fully match shipped behavior
