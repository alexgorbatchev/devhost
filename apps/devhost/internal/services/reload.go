package services

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"path/filepath"
	"reflect"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// configurationChange says how applyConfiguration differs from a plain reload.
type configurationChange struct {
	// restartStack relaunches every managed service with fresh automatic ports.
	restartStack bool
	// requested replaces the names of the services to run.
	requested []string
	// message is logged once the configuration is accepted.
	message string
}

func (r *stackRuntime) reloadConfiguration(ctx context.Context, next manifest.Manifest) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	return r.applyConfiguration(ctx, next, configurationChange{requested: r.manifest.requested, message: "configuration reloaded"})
}

// startServices starts services this run left stopped, with the services they
// depend on, and leaves the running ones untouched.
func (r *stackRuntime) startServices(ctx context.Context, names []string) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := r.checkReady(); err != nil {
		return err
	}
	if r.configured == nil {
		return fmt.Errorf("starting a service requires an accepted manifest")
	}
	for _, name := range names {
		if _, started := r.manifest.Services[name]; started {
			return fmt.Errorf("service %s is already started", name)
		}
		if _, stopped := r.manifest.Stopped[name]; !stopped {
			return fmt.Errorf("unknown service: %s", name)
		}
	}
	change := configurationChange{
		requested: append(slices.Clone(r.manifest.requested), names...),
		message:   fmt.Sprintf("started services: %s", strings.Join(names, ", ")),
	}
	err := r.applyConfiguration(ctx, *r.configured, change)
	if err != nil {
		r.logFailure("devhost", fmt.Errorf("starting %s failed: %w", strings.Join(names, ", "), err))
	}
	return err
}

func (r *stackRuntime) restartStack(ctx context.Context) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if r.configured == nil {
		return fmt.Errorf("stack restart requires an accepted manifest")
	}
	err := r.applyConfiguration(ctx, *r.configured, configurationChange{restartStack: true, requested: r.manifest.requested, message: "stack restarted with new automatic ports"})
	if err != nil {
		r.logFailure("devhost", fmt.Errorf("stack restart failed: %w", err))
	}
	return err
}

func (r *stackRuntime) applyConfiguration(ctx context.Context, next manifest.Manifest, change configurationChange) error {
	restartStack := change.restartStack
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.checkReady(); err != nil {
		return err
	}
	if next.Annotation.TempDir != nil {
		dir, err := filepath.Abs(*next.Annotation.TempDir)
		if err != nil {
			return err
		}
		*next.Annotation.TempDir = dir
	}
	if err := validateReloadBoundary(*r.configured, next); err != nil {
		return err
	}
	if !restartStack && reflect.DeepEqual(*r.configured, next) && slices.Equal(r.manifest.requested, change.requested) {
		return nil
	}
	order, err := ResolveServiceOrder(next)
	if err != nil {
		return err
	}
	resolvePorts := resolveReloadPorts
	if restartStack {
		resolvePorts = resolveStackRestartPorts
	}
	candidate, err := resolvePorts(next, *r.manifest, change.requested)
	if err != nil {
		return err
	}
	worktrees, err := buildStackWorktrees(candidate, r.routes.paths.StateDirectoryPath, r.worktrees)
	if err != nil {
		return err
	}
	candidate, blocked := worktrees.restore(candidate)
	for name, service := range candidate.Services {
		if restartStack && blocked[name] != "" {
			return fmt.Errorf("cannot restart stack: service %s is stopped: %s; select an available worktree first", name, blocked[name])
		}
		if isManagedService(service) && blocked[name] == "" {
			if err := validateServiceWorkingDirectory(service); err != nil {
				return err
			}
		}
	}
	affected := affectedReloadServices(*r.manifest, candidate)
	if restartStack {
		for name, service := range candidate.Services {
			if isManagedService(service) {
				affected[name] = true
			}
		}
	}
	expandReloadGroups(affected, *r.manifest, candidate, r.worktrees, worktrees)
	for name, reason := range r.blocked {
		if _, exists := candidate.Services[name]; exists && !affected[name] {
			blocked[name] = reason
		}
	}
	// An unrelated edit must not silently restart a repository in recovery.
	for _, repo := range r.worktrees.snapshot() {
		if repo.Error == "" {
			continue
		}
		changed := false
		for _, name := range repo.ServiceNames {
			changed = changed || affected[name]
		}
		if !changed {
			for _, name := range repo.ServiceNames {
				blocked[name] = repo.Error
			}
		}
	}
	rollbackClaims, err := r.claimReload(candidate)
	if err != nil {
		return errors.Join(err, rollbackClaims())
	}
	previous, previousWorktrees, previousOrder := *r.manifest, r.worktrees, r.order
	previousBlocked := maps.Clone(r.blocked)
	oldNames, nextNames := reloadOrder(previousOrder, affected), reloadOrder(order, affected)
	health, err := r.health()
	if err != nil {
		return errors.Join(err, rollbackClaims())
	}
	r.manifestMu.Lock()
	r.pendingReload = map[string]devtools.ServiceHealth{}
	for _, service := range health.Services {
		if affected[service.Name] {
			r.pendingReload[service.Name] = service
		}
	}
	for _, name := range nextNames {
		if _, exists := r.pendingReload[name]; !exists {
			r.pendingReload[name] = devtools.ServiceHealth{}
		}
	}
	r.manifestMu.Unlock()
	defer func() {
		r.manifestMu.Lock()
		r.pendingReload = nil
		r.manifestMu.Unlock()
		r.publish()
	}()
	r.publish()
	if err := r.stopReloadServices(oldNames); err != nil {
		return errors.Join(err, r.recoverReload(ctx, previous, previousWorktrees, previousOrder, previousBlocked, oldNames), rollbackClaims())
	}
	r.installReload(candidate, worktrees, order, blocked)
	rollback := func(err error) error {
		err = errors.Join(err, r.stopReloadServices(reloadOrder(order, affected)))
		if ctx.Err() != nil {
			// Shutdown owns final cleanup; do not launch restoration processes.
			return errors.Join(err, rollbackClaims())
		}
		return errors.Join(err, r.recoverReload(ctx, previous, previousWorktrees, previousOrder, previousBlocked, reloadOrder(previousOrder, affected)), rollbackClaims())
	}
	if err := r.startReloadServices(ctx, affected); err != nil {
		return rollback(err)
	}
	if err := ctx.Err(); err != nil {
		return rollback(err)
	}
	if err := r.routes.replace(*r.manifest); err != nil {
		return rollback(err)
	}
	if r.control != nil {
		if err := r.control.UpdateRouting(collectRoutedServiceIdentities(r.manifest.Services), r.manifest.PrimaryService); err != nil {
			return rollback(err)
		}
	}
	r.configured = &next
	r.removeRetiredServices()
	r.finishReloadWorktrees()
	r.manifestMu.Lock()
	r.routing = devtools.RoutingConfig{RoutedServices: collectRoutedServiceIdentities(r.manifest.Services), PrimaryService: r.manifest.PrimaryService}
	r.pendingReload = nil
	r.manifestMu.Unlock()
	r.publish()
	writeLogLine(r.options.LogWriter, r.manifest.Name, change.message)
	LogServiceURLs(*r.manifest, r.options.LogWriter)
	logStoppedServices(*r.manifest, r.options.LogWriter)
	return r.releaseClaimsExcept(collectClaimedHosts(r.manifest.Services), manifestFixedPortClaims(*r.manifest))
}

func (r *stackRuntime) installReload(m ResolvedManifest, worktrees *stackWorktrees, order []string, blocked map[string]string) {
	r.manifestMu.Lock()
	*r.manifest, r.worktrees, r.order, r.blocked = m, worktrees, order, blocked
	r.manifestMu.Unlock()
}

func (r *stackRuntime) stopReloadServices(names []string) error {
	for _, name := range names {
		r.watcher.StopWatching(name)
		r.dirty.SetDirty(name, false)
	}
	return r.stopGroup(names)
}

func (r *stackRuntime) startReloadServices(ctx context.Context, affected map[string]bool) error {
	for pass := 0; pass <= MaximumAutoPortRetryCount; pass++ {
		before := *r.manifest
		for _, name := range reloadOrder(r.order, affected) {
			if err := ctx.Err(); err != nil {
				return err
			}
			service, exists := r.manifest.Services[name]
			if !exists || r.blocked[name] != "" {
				continue
			}
			if err := r.watcher.StartWatching(name, service.Watch, service.Cwd); err != nil {
				return err
			}
			if isManagedService(service) {
				if err := r.start(ctx, name, runtimeStartOptions{AllowPortReassignment: true}); err != nil {
					return fmt.Errorf("start reloaded service %s: %w", name, err)
				}
			}
		}
		changed := affectedReloadServices(before, *r.manifest)
		if len(changed) == 0 {
			return nil
		}
		// A retry can change templates and injected ports in services that had
		// already launched, including otherwise unaffected repository groups.
		for name := range changed {
			affected[name] = true
		}
		expandReloadGroups(affected, before, *r.manifest, r.worktrees)
		r.manifestMu.Lock()
		for name := range affected {
			if _, exists := r.pendingReload[name]; !exists {
				r.pendingReload[name] = devtools.ServiceHealth{}
			}
		}
		r.manifestMu.Unlock()
		if err := r.stopReloadServices(reloadOrder(r.order, affected)); err != nil {
			return err
		}
	}
	return fmt.Errorf("automatic ports did not stabilize during configuration reload")
}

func (r *stackRuntime) recoverReload(ctx context.Context, previous ResolvedManifest, worktrees *stackWorktrees, order []string, blocked map[string]string, names []string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.installReload(previous, worktrees, order, blocked)
	affected := map[string]bool{}
	for _, name := range names {
		affected[name] = true
	}
	if err := r.startReloadServices(ctx, affected); err != nil {
		names = reloadOrder(order, affected)
		err = errors.Join(err, r.stopReloadServices(names))
		r.manifestMu.Lock()
		for _, name := range names {
			r.blocked[name] = err.Error()
		}
		r.manifestMu.Unlock()
		r.finishReloadWorktrees()
		r.publish()
		return fmt.Errorf("restore previous services: %w", err)
	}
	names = reloadOrder(order, affected)
	err := r.routes.replace(*r.manifest)
	if err != nil {
		err = errors.Join(err, r.stopReloadServices(names))
		r.manifestMu.Lock()
		for _, name := range names {
			r.blocked[name] = err.Error()
		}
		r.manifestMu.Unlock()
	}
	r.finishReloadWorktrees()
	r.publish()
	return err
}

func (r *stackRuntime) finishReloadWorktrees() {
	for _, repo := range r.worktrees.snapshot() {
		var err error
		for _, name := range repo.ServiceNames {
			if reason := r.blocked[name]; reason != "" {
				err = errors.New(reason)
				break
			}
		}
		r.worktrees.finish(repo.ID, err)
	}
}

func (r *stackRuntime) removeRetiredServices() {
	r.startedMu.Lock()
	var retained []*startedService
	for _, service := range r.started {
		if configured, exists := r.manifest.Services[service.service.Name]; exists && isManagedService(configured) && !usesDaemonLifecycle(configured) {
			retained = append(retained, service)
		}
	}
	r.started = retained
	r.startedMu.Unlock()
}
