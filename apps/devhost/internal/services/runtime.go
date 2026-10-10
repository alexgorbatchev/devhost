package services

import (
	"context"
	"fmt"
	"maps"
	"sort"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// stackRuntime owns process state. Startup and lifecycle operations are serialized;
// the health stream reads snapshots while commands and probes run outside these locks.
type stackRuntime struct {
	starting          map[string]bool
	failures          map[string]string
	startupComplete   bool
	configured        *manifest.Manifest
	pendingReload     map[string]devtools.ServiceHealth
	routing           devtools.RoutingConfig
	claimedFixedPorts []claimedFixedPort
	claimedHosts      []string
	manifest          *ResolvedManifest
	manifestMu        sync.RWMutex
	started           []*startedService
	startedMu         sync.Mutex
	daemons           []daemonLifecycleService
	daemonMu          sync.Mutex
	failedRoutes      map[string]*startedService
	operationMu       sync.Mutex
	shuttingDown      bool
	ready             bool
	order             []string
	exits             chan serviceExitResult
	options           StartStackOptions
	environment       map[string]string
	gracePeriod       time.Duration
	control           *devtools.ControlServer
	controlMu         sync.RWMutex
	routes            *stackRoutes
	watcher           *WatchManager
	dirty             *DirtyTracker
	worktrees         *stackWorktrees
	blocked           map[string]string
}

func (r *stackRuntime) health() (devtools.HealthResponse, error) {
	r.manifestMu.RLock()
	m := *r.manifest
	worktrees := r.worktrees
	pending := maps.Clone(r.pendingReload)
	failures := maps.Clone(r.failures)
	starting := maps.Clone(r.starting)
	routing := r.routing
	r.startedMu.Lock()
	started := append([]*startedService{}, r.started...)
	r.startedMu.Unlock()
	blocked := make(map[string]string, len(r.blocked))
	for name, reason := range r.blocked {
		blocked[name] = reason
	}
	r.manifestMu.RUnlock()
	h := collectServicesHealth(m, started, r.dirty)
	h.Repositories = worktrees.snapshot()
	h.Routing = &routing
	for i := range h.Services {
		s := &h.Services[i]
		if previous, exists := pending[s.Name]; exists {
			s.Status, s.Restarting, s.ExitCode = false, true, previous.ExitCode
		}
		if blocked[s.Name] != "" || failures[s.Name] != "" || starting[s.Name] {
			s.Status = false
		}
		for _, repo := range h.Repositories {
			for _, name := range repo.ServiceNames {
				if name == s.Name {
					s.Restarting = s.Restarting || repo.Switching
					s.ProjectRootPath = worktrees.projectRoot(m.ManifestDirectoryPath, name)
				}
			}
		}
	}
	return h, nil
}

func (r *stackRuntime) publish() {
	r.controlMu.RLock()
	control := r.control
	r.controlMu.RUnlock()
	if control != nil {
		_ = control.PublishHealthResponse()
	}
}

func (r *stackRuntime) checkReady() error {
	if r.shuttingDown {
		return fmt.Errorf("devhost is shutting down")
	}
	if !r.ready {
		return fmt.Errorf("devhost is still starting the stack")
	}
	return nil
}

func (r *stackRuntime) restart(ctx context.Context, serviceNames []string) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.checkReady(); err != nil {
		return err
	}
	for _, name := range serviceNames {
		s, ok := r.manifest.Services[name]
		if !ok {
			if _, stopped := r.manifest.Stopped[name]; stopped {
				return fmt.Errorf("service %s is not started", name)
			}
			return fmt.Errorf("unknown service: %s", name)
		}
		if !isManagedService(s) {
			return fmt.Errorf("service %s is unmanaged and cannot be restarted by devhost", name)
		}
	}
	order := map[string]int{}
	for i, name := range r.order {
		order[name] = i
	}
	serviceNames = append([]string{}, serviceNames...)
	sort.Slice(serviceNames, func(i, j int) bool { return order[serviceNames[i]] < order[serviceNames[j]] })
	for _, name := range serviceNames {
		for _, repo := range r.worktrees.snapshot() {
			if repo.Error == "" {
				continue
			}
			for _, member := range repo.ServiceNames {
				if member == name {
					return r.switchWorktreeLocked(ctx, repo.ID, repo.SelectedPath)
				}
			}
		}
		writeLogLine(r.options.LogWriter, r.manifest.Name, fmt.Sprintf("restarting service: %s", name))
		r.watcher.CancelTimer(name)
		r.dirty.SetDirty(name, false)
		if err := r.stop(name); err != nil {
			r.clearRestarting(name)
			return err
		}
		if r.blocked[name] != "" {
			service := r.manifest.Services[name]
			if err := r.watcher.StartWatching(name, service.Watch, service.Cwd); err != nil {
				r.clearRestarting(name)
				return err
			}
		}
		if err := r.start(ctx, name, runtimeStartOptions{RefreshRoute: true}); err != nil {
			r.clearRestarting(name)
			r.logFailure(name, err)
			return err
		}
		r.manifestMu.Lock()
		delete(r.blocked, name)
		r.manifestMu.Unlock()
		r.publish()
	}
	return nil
}

func (r *stackRuntime) stop(name string) error {
	r.manifestMu.Lock()
	if r.starting == nil {
		r.starting = map[string]bool{}
	}
	r.starting[name] = true
	r.manifestMu.Unlock()
	if failed := r.failedRoutes[name]; failed != nil {
		if err := stopStartedService(failed, r.gracePeriod); err != nil {
			return fmt.Errorf("clean up previous unrouted replacement: %w", err)
		}
		delete(r.failedRoutes, name)
	}
	r.daemonMu.Lock()
	var daemon *ResolvedService
	for _, started := range r.daemons {
		if started.service.Name == name {
			s := started.service
			daemon = &s
			break
		}
	}
	r.daemonMu.Unlock()
	if daemon != nil {
		// The stop command must run in the checkout that actually launched the daemon.
		if err := stopDaemonLifecycleService(*r.manifest, *daemon, r.options, r.environment, r.control); err != nil {
			return err
		}
		r.daemonMu.Lock()
		for i, started := range r.daemons {
			if started.service.Name == name {
				r.daemons = append(r.daemons[:i], r.daemons[i+1:]...)
				break
			}
		}
		r.daemonMu.Unlock()
	}
	r.startedMu.Lock()
	started := findStartedService(r.started, name)
	if started != nil {
		started.setRestarting(true)
	}
	r.startedMu.Unlock()
	r.publish()
	if started != nil {
		return stopStartedService(started, r.gracePeriod)
	}
	return nil
}

type runtimeStartOptions struct {
	RefreshRoute          bool
	AllowPortReassignment bool
}

func (r *stackRuntime) start(ctx context.Context, name string, options runtimeStartOptions) (returnedError error) {
	r.manifestMu.Lock()
	if r.starting == nil {
		r.starting = map[string]bool{}
	}
	r.starting[name] = true
	delete(r.failures, name)
	r.manifestMu.Unlock()
	defer func() {
		r.manifestMu.Lock()
		delete(r.starting, name)
		if returnedError != nil {
			if r.failures == nil {
				r.failures = map[string]string{}
			}
			r.failures[name] = returnedError.Error()
		}
		r.manifestMu.Unlock()
		r.publish()
	}()
	if err := ctx.Err(); err != nil {
		return err
	}
	attempt := *r.manifest
	s := attempt.Services[name]
	if usesDaemonLifecycle(s) {
		r.daemonMu.Lock()
		r.daemons = upsertStartedDaemonLifecycleService(r.daemons, s)
		r.daemonMu.Unlock()
		if err := startDaemonLifecycleService(ctx, &attempt, name, r.options, r.environment, r.control); err != nil {
			return joinCleanupError(err, r.stop(name))
		}
		if options.RefreshRoute {
			if err := r.routes.activate(s); err != nil {
				return joinCleanupError(err, r.stop(name))
			}
		}
		r.publish()
		return nil
	}
	started, err := startServiceWithRetries(ctx, &attempt, serviceStartOptions{ServiceName: name, Exits: r.exits, Stack: r.options, Environment: r.environment, Control: r.control, AllowPortReassignment: options.AllowPortReassignment})
	if err == nil && options.RefreshRoute {
		err = r.routes.activate(started.service)
		if err != nil {
			started.setRestarting(true)
			if stopErr := stopStartedService(started, r.gracePeriod); stopErr != nil {
				r.failedRoutes[name] = started
				err = joinCleanupError(err, stopErr)
			}
		}
	}
	if err != nil {
		if started != nil && (ctx.Err() != nil || started.ReadExitCode() != nil) {
			r.startedMu.Lock()
			r.started = removeStartedService(r.started, findStartedService(r.started, name))
			r.started = append(r.started, started)
			r.startedMu.Unlock()
		}
		return err
	}
	r.manifestMu.Lock()
	r.startedMu.Lock()
	r.manifest.Services = attempt.Services
	r.started = removeStartedService(r.started, findStartedService(r.started, name))
	r.started = append(r.started, started)
	r.startedMu.Unlock()
	r.manifestMu.Unlock()
	r.publish()
	return nil
}

func (r *stackRuntime) clearRestarting(name string) {
	r.manifestMu.Lock()
	delete(r.starting, name)
	r.manifestMu.Unlock()
	r.startedMu.Lock()
	if s := findStartedService(r.started, name); s != nil {
		s.setRestarting(false)
	}
	r.startedMu.Unlock()
	r.publish()
}

func (r *stackRuntime) logFailure(name string, err error) {
	writeLogLine(r.options.LogWriter, r.manifest.Name, err.Error())
	if r.control != nil {
		r.control.PublishLogEntry(name, devtools.ServiceLogStreamStderr, err.Error())
	}
}

func (r *stackRuntime) switchWorktree(ctx context.Context, id, path string) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.checkReady(); err != nil {
		return err
	}
	return r.switchWorktreeLocked(ctx, id, path)
}

func (r *stackRuntime) switchWorktreeLocked(ctx context.Context, id, path string) (returnedError error) {
	next, err := r.worktrees.prepare(id, path, *r.manifest)
	if err != nil {
		return err
	}
	var names []string
	for _, repo := range r.worktrees.snapshot() {
		if repo.ID == id {
			names = repo.ServiceNames
			break
		}
	}
	ordered := r.orderedGroup(names)
	defer func() {
		r.manifestMu.Lock()
		for _, name := range ordered {
			if returnedError != nil {
				r.blocked[name] = returnedError.Error()
			} else {
				delete(r.blocked, name)
			}
		}
		r.manifestMu.Unlock()
		r.worktrees.finish(id, returnedError)
		r.publish()
	}()
	r.publish()
	for _, name := range ordered {
		r.watcher.StopWatching(name)
		r.dirty.SetDirty(name, false)
	}
	if err := r.stopGroup(ordered); err != nil {
		return err
	}
	r.manifestMu.Lock()
	r.manifest.Services = next.Services
	r.manifestMu.Unlock()
	for _, name := range ordered {
		s := r.manifest.Services[name]
		if err := r.watcher.StartWatching(name, s.Watch, s.Cwd); err != nil {
			returnedError = err
			break
		}
		if err := r.start(ctx, name, runtimeStartOptions{RefreshRoute: true}); err != nil {
			returnedError = err
			r.logFailure(name, err)
			break
		}
	}
	if returnedError != nil {
		returnedError = joinCleanupError(returnedError, r.stopGroup(ordered))
		return returnedError
	}
	return nil
}

func (r *stackRuntime) orderedGroup(names []string) []string {
	ordered := []string{}
	for _, name := range r.order {
		for _, member := range names {
			if member == name {
				ordered = append(ordered, name)
			}
		}
	}
	return ordered
}

func (r *stackRuntime) stopGroup(names []string) error {
	var err error
	for i := len(names) - 1; i >= 0; i-- {
		err = appendCleanupError(err, r.stop(names[i]))
		r.clearRestarting(names[i])
	}
	return err
}

func (r *stackRuntime) failWorktreeStartup(name string, err error) error {
	for _, repo := range r.worktrees.snapshot() {
		for _, member := range repo.ServiceNames {
			if member != name {
				continue
			}
			err = joinCleanupError(err, r.stopGroup(r.orderedGroup(repo.ServiceNames)))
			r.manifestMu.Lock()
			for _, name := range repo.ServiceNames {
				r.blocked[name] = err.Error()
			}
			r.manifestMu.Unlock()
			r.logFailure(name, err)
			return nil
		}
	}
	return err
}
