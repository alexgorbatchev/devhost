package services

import (
	"context"
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/x/ansi"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

const (
	StackModeForeground = "foreground"
	StackModeDetached   = "detached"

	StackRunStateRunning  = "running"
	StackRunStateStarting = "starting"
	StackRunStateDegraded = "degraded"

	ServiceStateReady      = "ready"
	ServiceStateStarting   = "starting"
	ServiceStateRestarting = "restarting"
	ServiceStateExited     = "exited"
	ServiceStateFailed     = "failed"
	ServiceStateUnhealthy  = "unhealthy"
	ServiceStateNotStarted = "not-started"
)

// StackInfo describes a running stack and the live state of every service in it.
type StackInfo struct {
	Name          string
	PID           int
	Mode          string
	Remote        bool
	Ready         bool
	RunState      string
	ManifestPath  string
	ManifestFiles []string
	ControlPort   int
	LogPath       string
	CreatedAt     string
	Services      []devtools.StackServiceInfo
}

// StackNotRunningError is returned when no running stack matches the requested manifest.
type StackNotRunningError struct {
	ManifestPath     string
	OtherStacksCount int
}

func (e *StackNotRunningError) Error() string {
	return fmt.Sprintf("no running stack found for manifest: %s", e.ManifestPath)
}

// ReadStackInfo resolves the running stack for manifestPath and fetches live per-service details.
func ReadStackInfo(ctx context.Context, manifestPath string, environment map[string]string) (StackInfo, error) {
	absoluteManifestPath, err := filepath.Abs(manifestPath)
	if err != nil {
		return StackInfo{}, fmt.Errorf("resolve absolute manifest path for %s: %w", manifestPath, err)
	}
	absoluteManifestPath = filepath.Clean(absoluteManifestPath)

	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return StackInfo{}, fmt.Errorf("resolve caddy paths from environment: %w", err)
	}

	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		return StackInfo{}, fmt.Errorf("read running stacks: %w", err)
	}

	stack, found := matchLiveStack(stacks, absoluteManifestPath)
	if !found {
		return StackInfo{}, &StackNotRunningError{
			ManifestPath:     absoluteManifestPath,
			OtherStacksCount: len(stacks),
		}
	}

	mode := StackModeForeground
	if stack.LogPath != "" {
		mode = StackModeDetached
	}

	info := StackInfo{
		Name:          stack.Name,
		PID:           stack.PID,
		Mode:          mode,
		Remote:        stack.Remote,
		ManifestPath:  stack.ManifestPath,
		ManifestFiles: orderedManifestFiles(stack.ManifestPath, stack.ManifestFiles),
		ControlPort:   stack.ControlPort,
		LogPath:       stack.LogPath,
		CreatedAt:     normalizeTimestamp(stack.StartedAt),
	}

	if stack.ControlPort <= 0 {
		info.Ready = false
		info.RunState = StackRunStateStarting
		return info, nil
	}

	snapshot, err := devtools.ReadStackInfo(ctx, stack.ControlPort)
	if err != nil {
		return StackInfo{}, fmt.Errorf("read live state from stack %s (PID %d): %w", stack.Name, stack.PID, err)
	}

	if snapshot.Name != "" {
		info.Name = snapshot.Name
	}
	if len(snapshot.ManifestFiles) > 0 {
		info.ManifestFiles = orderedManifestFiles(stack.ManifestPath, snapshot.ManifestFiles)
	}
	info.Services = snapshot.Services
	info.Ready, info.RunState = summarizeServicesState(snapshot.Services)
	if snapshot.Starting && info.Ready {
		info.Ready, info.RunState = false, StackRunStateStarting
	}
	return info, nil
}

func matchLiveStack(stacks []caddy.LiveStack, manifestPath string) (caddy.LiveStack, bool) {
	targetIdentity := caddy.ManifestIdentity(manifestPath)
	for _, stack := range stacks {
		if caddy.ManifestIdentity(stack.ManifestPath) == targetIdentity {
			return stack, true
		}
	}
	for _, stack := range stacks {
		for _, included := range stack.ManifestFiles {
			if caddy.ManifestIdentity(included) == targetIdentity {
				return stack, true
			}
		}
	}
	return caddy.LiveStack{}, false
}

func summarizeServicesState(services []devtools.StackServiceInfo) (bool, string) {
	hasStarting := false
	hasUnhealthy := false
	for _, service := range services {
		switch service.State {
		case ServiceStateNotStarted, ServiceStateReady:
		case ServiceStateStarting, ServiceStateRestarting:
			hasStarting = true
		default:
			hasUnhealthy = true
		}
	}
	if hasUnhealthy {
		return false, StackRunStateDegraded
	}
	if hasStarting {
		return false, StackRunStateStarting
	}
	return true, StackRunStateRunning
}

func (r *stackRuntime) stackInfo(ctx context.Context) (devtools.StackInfoSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return devtools.StackInfoSnapshot{}, err
	}
	r.manifestMu.RLock()
	m := *r.manifest
	starting := maps.Clone(r.starting)
	failures := maps.Clone(r.failures)
	blocked := maps.Clone(r.blocked)
	pending := maps.Clone(r.pendingReload)
	stateSince := maps.Clone(r.stateSince)
	manifestFiles := slices.Clone(r.manifestFiles)
	worktrees := r.worktrees
	createdAt := r.createdAt
	startupComplete := r.startupComplete

	r.startedMu.Lock()
	started := append([]*startedService{}, r.started...)
	r.startedMu.Unlock()
	r.manifestMu.RUnlock()

	r.controlMu.RLock()
	control := r.control
	r.controlMu.RUnlock()

	if r.routes != nil {
		settings, ok, err := caddy.ReadAppliedManagedCaddySettings(r.routes.paths)
		if err != nil {
			return devtools.StackInfoSnapshot{}, err
		}
		if ok {
			m.Caddy = settings
		}
	}

	switchingServices := map[string]bool{}
	for _, repo := range worktrees.snapshot() {
		if !repo.Switching {
			continue
		}
		for _, name := range repo.ServiceNames {
			switchingServices[name] = true
		}
	}

	result := devtools.StackInfoSnapshot{
		Name:          m.Name,
		Starting:      !startupComplete,
		ManifestFiles: orderedManifestFiles(m.ManifestPath, manifestFiles),
		Services:      make([]devtools.StackServiceInfo, 0, len(m.Services)+len(m.Stopped)),
	}

	for _, name := range orderedManifestServiceNames(m) {
		service := m.Services[name]
		process := findStartedService(started, name)
		_, isPending := pending[name]

		info := devtools.StackServiceInfo{
			Name:    name,
			Primary: name == m.PrimaryService,
			Port:    cloneIntPointer(service.Port),
			URLs:    m.serviceURLs(service),
		}

		since := stateSince[name]
		if since.IsZero() && process != nil && !process.startedAt.IsZero() {
			since = process.startedAt
		}
		if since.IsZero() {
			since = createdAt
		}

		switch {
		case switchingServices[name]:
			info.State = ServiceStateStarting
		case blocked[name] != "":
			info.State = ServiceStateFailed
			info.LastOutput = lastServiceOutputLine(control, name, blocked[name])
		case starting[name] || isPending:
			info.State = ServiceStateStarting
		case process != nil && process.isRestartingValue():
			info.State = ServiceStateRestarting
		case process != nil && process.unexpectedExitCode() != nil:
			info.State = ServiceStateExited
			info.ExitCode = process.unexpectedExitCode()
			if exitedAt := process.readExitedAt(); !exitedAt.IsZero() {
				since = exitedAt
			}
			info.LastOutput = lastServiceOutputLine(control, name, failures[name])
		case failures[name] != "":
			info.State = ServiceStateFailed
			info.LastOutput = lastServiceOutputLine(control, name, failures[name])
		default:
			healthy := false
			if !isManagedService(service) || usesDaemonLifecycle(service) {
				healthy = probeServiceHealth(ctx, service.Health)
			} else if process != nil && process.ReadExitCode() == nil {
				healthy = probeServiceHealth(ctx, service.Health)
			}
			if healthy {
				info.State = ServiceStateReady
			} else {
				info.State = ServiceStateUnhealthy
			}
		}

		if err := ctx.Err(); err != nil {
			return devtools.StackInfoSnapshot{}, err
		}
		if !since.IsZero() {
			info.Since = since.UTC().Format(time.RFC3339)
		}
		result.Services = append(result.Services, info)
	}

	for _, name := range stoppedServiceNames(m) {
		service := m.Stopped[name]
		result.Services = append(result.Services, devtools.StackServiceInfo{
			Name:    name,
			State:   ServiceStateNotStarted,
			Primary: name == m.PrimaryService,
			Port:    cloneIntPointer(service.Port),
		})
	}

	return result, nil
}

func lastServiceOutputLine(control *devtools.ControlServer, serviceName, fallback string) string {
	if control != nil {
		lines := control.ServiceLogLines(serviceName)
		prefix := "[" + serviceName + "]"
		for i := len(lines) - 1; i >= 0; i-- {
			cleaned := strings.TrimSpace(strings.TrimPrefix(ansi.Strip(lines[i]), prefix))
			if cleaned != "" {
				return cleaned
			}
		}
	}
	return strings.TrimSpace(ansi.Strip(fallback))
}

func orderedManifestFiles(rootManifest string, files []string) []string {
	var ordered []string
	seen := map[string]struct{}{}
	add := func(path string) {
		if path == "" {
			return
		}
		if abs, err := filepath.Abs(path); err == nil {
			path = filepath.Clean(abs)
		}
		identity := caddy.ManifestIdentity(path)
		if _, exists := seen[identity]; exists {
			return
		}
		seen[identity] = struct{}{}
		ordered = append(ordered, path)
	}
	add(rootManifest)
	var extras []string
	for _, file := range files {
		if file == "" {
			continue
		}
		if abs, err := filepath.Abs(file); err == nil {
			file = filepath.Clean(abs)
		}
		identity := caddy.ManifestIdentity(file)
		if _, exists := seen[identity]; exists {
			continue
		}
		seen[identity] = struct{}{}
		extras = append(extras, file)
	}
	sort.Strings(extras)
	return append(ordered, extras...)
}

func normalizeTimestamp(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return raw
	}
	return parsed.UTC().Format(time.RFC3339)
}

func cloneIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
