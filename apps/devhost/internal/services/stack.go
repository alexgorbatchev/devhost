package services

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	defaultLogLabel             = "devhost"
	maxAttemptOutputLines       = 50
	shutdownGracePeriod         = 10 * time.Second
	lateListenerMonitorDuration = 2 * time.Second
	lateListenerPollInterval    = 100 * time.Millisecond
	lifecycleCommandWaitDelay   = 100 * time.Millisecond
)

var serviceSignalSender = sendSignal
var startDevtoolsControlServer = devtools.StartControlServer
var startDocumentInjectionServer = devtools.StartDocumentInjectionServer
var registerProcessSignals = func(ch chan<- os.Signal) {
	signal.Notify(ch, supportedSignals...)
}
var unregisterProcessSignals = signal.Stop
var serviceContainmentTokenCounter atomic.Uint64
var readListeningProcessIDs = readListeningProcessIDsForBindHost

var supportedSignals = []os.Signal{syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM}

var signalExitCodes = map[syscall.Signal]int{
	syscall.SIGINT:  130,
	syscall.SIGHUP:  129,
	syscall.SIGTERM: 143,
}

type StartStackOptions struct {
	Configuration       *manifest.Manifest
	CaddyOutputWriters  caddy.RouteCommandOutputWriters
	CaddyPaths          caddy.Paths
	Environment         map[string]string
	LogWriter           io.Writer
	ServiceStdoutWriter io.Writer
	ServiceStderrWriter io.Writer
	ShutdownGracePeriod time.Duration
	IdleTimeout         time.Duration
}

type startedService struct {
	cmd         *exec.Cmd
	containment *serviceContainment
	service     ResolvedService
	exited      chan struct{}
	outputWG    sync.WaitGroup

	restartMu               sync.Mutex
	isRestarting            bool
	exitedBeforeRestart     bool
	exitMu                  sync.Mutex
	exitCode                int
	hasExited               bool
	shutdownMu              sync.Mutex
	shutdownAt              time.Time
	shutdownWith            syscall.Signal
	lastLateListenerCheckAt time.Time
}

type claimedFixedPort struct {
	bindHost string
	port     int
}

type serviceExitResult struct {
	exitCode    int
	serviceName string
}

type processStartOptions struct {
	attemptOutput *attemptOutputLines
	environment   map[string]string
	onStderrLine  func(string)
	onStdoutLine  func(string)
	stderrWriter  io.Writer
	stdoutWriter  io.Writer
}

type daemonLifecycleService struct {
	service ResolvedService
}

func StartStack(manifest *ResolvedManifest, serviceOrder []string, options StartStackOptions) (exitCode int, returnedError error) {
	if manifest == nil {
		return 0, fmt.Errorf("manifest is required")
	}

	if len(serviceOrder) == 0 {
		return 0, fmt.Errorf("service order is required")
	}

	environment := copyEnvironment(options.Environment)
	if len(environment) == 0 {
		environment = readCurrentEnvironment()
	}

	paths, err := resolveStartStackPaths(options.CaddyPaths, environment)
	if err != nil {
		return 0, err
	}

	gracePeriod := options.ShutdownGracePeriod
	if gracePeriod <= 0 {
		gracePeriod = shutdownGracePeriod
	}

	runtimeDevtoolsFeatures := resolveSupportedDevtoolsFeatures(manifest.Devtools, manifest.Annotation)
	devtoolsEnabled := hasEnabledDevtools(manifest.Devtools) && hasEnabledRuntimeDevtools(runtimeDevtoolsFeatures)
	worktrees, err := newStackWorktrees(*manifest, paths.StateDirectoryPath)
	if err != nil {
		return 0, err
	}
	initial, blocked := worktrees.restore(*manifest)
	*manifest = initial
	lifecycleCtx, cancelLifecycle := context.WithCancel(context.Background())
	defer cancelLifecycle()
	state := &stackRuntime{
		configured: options.Configuration,
		routing:    devtools.RoutingConfig{RoutedServices: collectRoutedServiceIdentities(initial.Services), PrimaryService: initial.PrimaryService},
		manifest:   manifest, order: append([]string{}, serviceOrder...), options: options, environment: environment,
		gracePeriod: gracePeriod, worktrees: worktrees, blocked: blocked, failedRoutes: map[string]*startedService{},
		exits: make(chan serviceExitResult, len(serviceOrder)),
	}
	signalExits := make(chan os.Signal, 1)
	documentInjectionServers := map[string]*devtools.DocumentInjectionServer{}
	var devtoolsControlServer *devtools.ControlServer
	var cleanupError error
	routes := stackRoutes{manifest: *manifest, paths: paths, outputWriters: options.CaddyOutputWriters, documentServers: documentInjectionServers, active: map[string]caddy.ActivateRouteOptions{}}

	dirtyTracker := NewDirtyTracker()
	onDirty := func(serviceName string) {
		state.publish()
	}
	watchManager := NewWatchManager(dirtyTracker, onDirty, options.LogWriter, manifest.Name)
	state.watcher, state.dirty, state.routes = watchManager, dirtyTracker, &routes

	defer watchManager.StopAll()
	for _, s := range manifest.Services {
		if len(s.Watch) > 0 && blocked[s.Name] == "" {
			if err := watchManager.StartWatching(s.Name, s.Watch, s.Cwd); err != nil {
				return 0, fmt.Errorf("failed to start watching for service %s: %w", s.Name, err)
			}
		}
	}

	managedCaddyAdminAddress := caddy.ResolveManagedCaddyAdminAddress(manifest.Caddy.Global.AdminAddress)
	fallback := caddy.ManagedCaddyConfigFallback{
		AdminAddress: manifest.Caddy.Global.AdminAddress,
		BindHost:     manifest.Caddy.Global.BindHost,
		HTTPEnabled:  manifest.Caddy.Global.HTTP,
		HTTPPort:     manifest.Caddy.Global.HTTPPort,
		HTTPSPort:    manifest.Caddy.Global.HTTPSPort,
		RuntimeOS:    runtime.GOOS,
	}
	registerProcessSignals(signalExits)
	defer unregisterProcessSignals(signalExits)

	defer func() {
		cancelLifecycle()
		state.operationMu.Lock()
		state.shuttingDown = true
		state.operationMu.Unlock()
		if watchManager != nil {
			watchManager.StopAll()
		}

		state.startedMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, state.started...)
		state.startedMu.Unlock()
		for _, failed := range state.failedRoutes {
			startedServicesSnapshot = append(startedServicesSnapshot, failed)
		}
		state.daemonMu.Lock()
		startedDaemonServicesSnapshot := append([]daemonLifecycleService{}, state.daemons...)
		state.daemonMu.Unlock()
		cleanupError = appendCleanupError(cleanupError, stopStartedServices(startedServicesSnapshot, gracePeriod))
		cleanupError = appendCleanupError(cleanupError, stopDaemonLifecycleServices(*manifest, startedDaemonServicesSnapshot, options, environment, devtoolsControlServer))

		for _, documentInjectionServer := range documentInjectionServers {
			if documentInjectionServer == nil {
				continue
			}
			cleanupError = appendCleanupError(cleanupError, documentInjectionServer.Stop())
		}

		if devtoolsControlServer != nil {
			cleanupError = appendCleanupError(cleanupError, devtoolsControlServer.Stop())
		}

		for _, host := range state.claimedHosts {
			cleanupError = appendCleanupError(cleanupError, caddy.ReleaseHostClaim(caddy.ClaimHostOptions{
				Host:                       host,
				ManifestPath:               manifest.ManifestPath,
				RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
			}))
		}

		for _, route := range routes.registrations() {
			cleanupError = appendCleanupError(cleanupError, caddy.UnregisterRoute(route.ServiceName, route.Host, route.Path, manifest.ManifestPath, paths.RegistrationsDirectoryPath, fallback, options.CaddyOutputWriters))
		}

		for _, host := range state.claimedHosts {
			cleanupError = appendCleanupError(cleanupError, caddy.SyncManagedHostRoute(host, managedCaddyAdminAddress, paths.RoutesDirectoryPath, options.CaddyOutputWriters))
		}

		for _, claim := range state.claimedFixedPorts {
			cleanupError = appendCleanupError(cleanupError, caddy.ReleaseFixedPortClaim(caddy.ClaimFixedPortOptions{
				BindHost:                claim.bindHost,
				ManifestPath:            manifest.ManifestPath,
				Port:                    claim.port,
				PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
			}))
		}

		if cleanupError != nil {
			returnedError = joinCleanupError(returnedError, cleanupError)
		}
	}()

	if err := caddy.EnsureManagedCaddyConfig(paths, fallback); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}

	if err := caddy.CleanupStaleRegistrations(paths.RegistrationsDirectoryPath, fallback); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	settings, err := caddy.ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	routes.settings = settings
	managedCaddyAdminAddress = settings.AdminAddress
	fallback = caddy.ManagedCaddyConfigFallback{AdminAddress: settings.AdminAddress, BindHost: settings.BindHost, HTTPEnabled: settings.HTTPEnabled, HTTPPort: settings.HTTPPort, HTTPSPort: settings.HTTPSPort, RuntimeOS: runtime.GOOS}

	if err := caddy.CleanupStaleFixedPortClaims(paths.PortClaimsDirectoryPath); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}

	if err := caddy.EnsureManagedCaddyAdminAvailable(caddy.CreateCaddyAdminAPIURL(managedCaddyAdminAddress), caddy.AdminAvailabilityDependencies{}); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}

	for _, service := range manifest.Services {
		if service.PortSource != "fixed" || service.Port == nil {
			continue
		}

		if err := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
			BindHost:                service.BindHost,
			ManifestPath:            manifest.ManifestPath,
			Port:                    *service.Port,
			PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
			KillZombies:             manifest.KillZombies,
			LogWriter:               options.LogWriter,
		}); err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}

		state.claimedFixedPorts = append(state.claimedFixedPorts, claimedFixedPort{bindHost: service.BindHost, port: *service.Port})
	}

	for _, host := range collectClaimedHosts(manifest.Services) {
		if err := caddy.ClaimHost(caddy.ClaimHostOptions{
			Host:                       host,
			ManifestPath:               manifest.ManifestPath,
			RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
			KillZombies:                manifest.KillZombies,
			LogWriter:                  options.LogWriter,
		}); err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}

		state.claimedHosts = append(state.claimedHosts, host)
	}

	routedServices := collectRoutedServiceIdentities(manifest.Services)
	if devtoolsEnabled {
		devSource, err := loadDevSourceCheckout(environment, manifest.ManifestDirectoryPath)
		if err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}
		if devSource != nil {
			writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Rebuilding devtools assets on demand from source checkout: %s", devSource.RootPath()))
		}

		var switchWorktree func(string, string) error
		var refreshWorktrees func() error
		if worktrees != nil {
			switchWorktree = func(id, path string) error { return state.switchWorktree(lifecycleCtx, id, path) }
			refreshWorktrees = state.refreshWorktrees
		}
		controlServer, err := startDevtoolsControlServer(devtools.StartControlServerOptions{
			AnnotationActions:         manifest.Annotation.Actions,
			AnnotationDefaultActionID: manifest.Annotation.DefaultActionID,
			ComponentEditor:           manifest.Devtools.Editor.IDE,
			DevSource:                 devSource,
			FeatureToggles:            runtimeDevtoolsFeatures,
			GetHealthResponse:         state.health,
			ManifestPath:              manifest.ManifestPath,
			Position:                  manifest.Devtools.Status.Position,
			ProjectRootPath:           manifest.ManifestDirectoryPath,
			PrimaryService:            manifest.PrimaryService,
			RestartService:            func(names []string) error { return state.restart(lifecycleCtx, names) },
			RestartStack:              func() error { return state.restartStack(lifecycleCtx) },
			SwitchWorktree:            switchWorktree,
			RefreshWorktrees:          refreshWorktrees,
			GetToolContext:            state.toolContext,
			RestartServicesShortcut:   manifest.Devtools.Shortcuts.RestartServices,
			RoutedServices:            routedServices,
			StateDirectoryPath:        paths.StateDirectoryPath,
			StackName:                 manifest.Name,
		})
		if err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}

		devtoolsControlServer = controlServer
		state.controlMu.Lock()
		state.control = controlServer
		state.controlMu.Unlock()
		routes.controlServer = controlServer
	}

	groupedServices := map[string]bool{}
	for _, repo := range worktrees.snapshot() {
		for _, name := range repo.ServiceNames {
			groupedServices[name] = true
		}
	}
	for _, serviceName := range serviceOrder {
		service, ok := manifest.Services[serviceName]
		if !ok {
			return 0, joinCleanupError(fmt.Errorf("unknown service: %s", serviceName), cleanupError)
		}

		if isManagedService(service) && blocked[serviceName] == "" {
			if groupedServices[serviceName] {
				if err := state.start(lifecycleCtx, serviceName, runtimeStartOptions{AllowPortReassignment: true}); err != nil {
					if err := state.failWorktreeStartup(serviceName, err); err != nil {
						return 0, err
					}
				}
				service = manifest.Services[serviceName]
			} else if usesDaemonLifecycle(service) {
				if err := startDaemonLifecycleService(lifecycleCtx, manifest, serviceName, options, environment, devtoolsControlServer); err != nil {
					return 0, joinCleanupError(err, cleanupError)
				}

				state.daemonMu.Lock()
				state.daemons = append(state.daemons, daemonLifecycleService{service: manifest.Services[serviceName]})
				state.daemonMu.Unlock()

				service = manifest.Services[serviceName]
			} else {
				attemptManifest := *manifest
				started, err := startServiceWithRetries(lifecycleCtx, &attemptManifest, serviceStartOptions{ServiceName: serviceName, Exits: state.exits, Stack: options, Environment: environment, Control: devtoolsControlServer, AllowPortReassignment: true})
				if err != nil {
					if started == nil || started.ReadExitCode() == nil {
						return 0, joinCleanupError(err, cleanupError)
					}
					writeLogLine(options.LogWriter, manifest.Name, err.Error())
					state.exits <- serviceExitResult{exitCode: started.exitCodeValue(), serviceName: serviceName}
				}

				state.manifestMu.Lock()
				manifest.Services = attemptManifest.Services
				state.startedMu.Lock()
				state.started = append(state.started, started)
				state.startedMu.Unlock()
				state.manifestMu.Unlock()

				service = started.service
			}
		}

		if len(service.Hosts) == 0 || service.Port == nil {
			continue
		}

		if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.Global.HTTPSPort); warning != "" {
			writeLogLine(options.LogWriter, manifest.Name, warning)
		}

		if err := routes.activate(service); err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}
	}
	for _, repo := range worktrees.snapshot() {
		var groupError error
		for _, name := range repo.ServiceNames {
			if blocked[name] != "" {
				groupError = fmt.Errorf("%s", blocked[name])
				break
			}
		}
		worktrees.finish(repo.ID, groupError)
	}
	LogServiceURLs(*manifest, options.LogWriter)

	finalIdleTimeout := options.IdleTimeout
	if finalIdleTimeout == 0 && manifest.Devtools.IdleTimeout != "" {
		if d, err := time.ParseDuration(manifest.Devtools.IdleTimeout); err == nil {
			finalIdleTimeout = d
		}
	}

	if finalIdleTimeout > 0 {
		writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Idle timeout enabled: %s (will automatically shut down when inactive)", finalIdleTimeout))
	}

	idleShutdownChan := make(chan struct{}, 1)
	if finalIdleTimeout > 0 && devtoolsControlServer != nil {
		logFilePath := filepath.Join(paths.CaddyDirectoryPath, "logs", fmt.Sprintf("%s_access.log", manifest.Name))
		_ = os.MkdirAll(filepath.Dir(logFilePath), 0o755)
		if runtime.GOOS != "windows" {
			if f, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644); err == nil {
				_ = f.Close()
			}
		}

		pollerCtx, pollerCancel := context.WithCancel(context.Background())
		defer pollerCancel()

		go func() {
			var lastModTime time.Time
			if info, err := os.Stat(logFilePath); err == nil {
				lastModTime = info.ModTime()
			}

			statInterval := 2 * time.Second
			if finalIdleTimeout < statInterval {
				statInterval = finalIdleTimeout / 2
				if statInterval < 10*time.Millisecond {
					statInterval = 10 * time.Millisecond
				}
			}
			ticker := time.NewTicker(statInterval)
			defer ticker.Stop()

			for {
				select {
				case <-pollerCtx.Done():
					return
				case <-ticker.C:
					info, err := os.Stat(logFilePath)
					if err == nil {
						modTime := info.ModTime()
						if lastModTime.IsZero() {
							lastModTime = modTime
						} else if modTime.After(lastModTime) {
							lastModTime = modTime
							devtoolsControlServer.Tracker().RecordActivity()
						}
					}
				}
			}
		}()

		go func() {
			checkInterval := 5 * time.Second
			if finalIdleTimeout < checkInterval {
				checkInterval = finalIdleTimeout / 2
				if checkInterval < 10*time.Millisecond {
					checkInterval = 10 * time.Millisecond
				}
			}
			ticker := time.NewTicker(checkInterval)
			defer ticker.Stop()

			for {
				select {
				case <-pollerCtx.Done():
					return
				case <-ticker.C:
					if devtoolsControlServer.Tracker().IsIdle(finalIdleTimeout) && !devtoolsControlServer.HasActiveTerminalSessions() {
						select {
						case idleShutdownChan <- struct{}{}:
						default:
						}
						return
					}
				}
			}
		}()
	}

	var manifestEvents <-chan error
	var manifestWatch *manifestWatcher
	if state.configured != nil {
		manifestWatch, err = state.watchManifest()
		if err != nil {
			return 0, err
		}
		defer func() { returnedError = errors.Join(returnedError, manifestWatch.close()) }()
		manifestEvents = manifestWatch.events
	}
	state.operationMu.Lock()
	state.ready = true
	state.operationMu.Unlock()
	lastReloadError := ""
	stackName := manifest.Name
	var reloadResults <-chan error
	defer func() {
		cancelLifecycle()
		if reloadResults != nil {
			<-reloadResults
		}
	}()
	if manifestWatch != nil {
		// Configuration may have changed while the initial services started.
		manifestWatch.notify(nil)
	}
	for {
		select {
		case err := <-manifestEvents:
			completed := make(chan error, 1)
			reloadResults = completed
			manifestEvents = nil
			go func() {
				if err == nil {
					err = state.reloadFromDisk(lifecycleCtx, manifestWatch)
				}
				completed <- err
			}()
		case err := <-reloadResults:
			reloadResults = nil
			manifestEvents = manifestWatch.events
			if err != nil {
				if message := err.Error(); message != lastReloadError {
					writeLogLine(options.LogWriter, stackName, fmt.Sprintf("configuration reload rejected: %v", err))
					lastReloadError = message
				}
			} else {
				lastReloadError = ""
			}
		case result := <-state.exits:
			writeLogLine(options.LogWriter, stackName, fmt.Sprintf("%s exited with code %d; devhost is waiting for a restart.", result.serviceName, result.exitCode))
		case receivedSignal := <-signalExits:
			cancelLifecycle()
			state.startedMu.Lock()
			startedServicesSnapshot := append([]*startedService{}, state.started...)
			state.startedMu.Unlock()
			forwardStartedServicesSignal(startedServicesSnapshot, receivedSignal)
			return readSignalExitCode(receivedSignal), nil
		case <-idleShutdownChan:
			cancelLifecycle()
			writeLogLine(options.LogWriter, stackName, fmt.Sprintf("Idle timeout of %s reached. Automatically shutting down the stack...", finalIdleTimeout))
			state.startedMu.Lock()
			startedServicesSnapshot := append([]*startedService{}, state.started...)
			state.startedMu.Unlock()
			forwardStartedServicesSignal(startedServicesSnapshot, syscall.SIGTERM)
			return 0, nil
		}
	}
}

func CreateInjectedServiceEnvironment(manifest ResolvedManifest, service ResolvedService) map[string]string {
	environment := map[string]string{
		"DEVHOST_BIND_HOST":     service.BindHost,
		"DEVHOST_MANIFEST_PATH": manifest.ManifestPath,
		"DEVHOST_SERVICE_NAME":  service.Name,
	}

	if service.Port != nil && service.InjectPort {
		environment["PORT"] = fmt.Sprintf("%d", *service.Port)
	}

	if len(service.Hosts) > 0 {
		environment["DEVHOST_HOST"] = service.Hosts[0]
	}

	if service.Path != nil {
		environment["DEVHOST_PATH"] = *service.Path
	}

	for _, otherService := range manifest.Services {
		if otherService.Port != nil {
			envSafeName := toEnvSafeName(otherService.Name)
			environment["DEVHOST_PORT_"+envSafeName] = fmt.Sprintf("%d", *otherService.Port)
		}
	}

	return environment
}

func toEnvSafeName(name string) string {
	var builder strings.Builder
	builder.Grow(len(name))
	for i := 0; i < len(name); i++ {
		b := name[i]
		if (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') {
			builder.WriteByte(b)
		} else if b >= 'a' && b <= 'z' {
			builder.WriteByte(b - 'a' + 'A')
		} else {
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

func LogServiceURLs(manifest ResolvedManifest, writer io.Writer) {
	for _, serviceName := range orderedManifestServiceNames(manifest) {
		service, ok := manifest.Services[serviceName]
		if !ok {
			continue
		}

		displayName := service.Name
		if service.Name == manifest.PrimaryService {
			displayName = fmt.Sprintf("%s (primary)", service.Name)
		}
		for _, serviceURL := range readServiceURLs(service, manifest.Caddy.Global.HTTPSPort) {
			writeLogLine(writer, manifest.Name, fmt.Sprintf("%s: %s", displayName, serviceURL))
		}
	}
}

func orderedManifestServiceNames(manifest ResolvedManifest) []string {
	orderedNames := make([]string, 0, len(manifest.Services))
	seenServiceNames := make(map[string]struct{}, len(manifest.Services))

	for _, serviceName := range manifest.ServiceOrder {
		if _, ok := manifest.Services[serviceName]; !ok {
			continue
		}
		if _, ok := seenServiceNames[serviceName]; ok {
			continue
		}

		orderedNames = append(orderedNames, serviceName)
		seenServiceNames[serviceName] = struct{}{}
	}

	remainingServiceNames := make([]string, 0, len(manifest.Services)-len(seenServiceNames))
	for serviceName := range manifest.Services {
		if _, ok := seenServiceNames[serviceName]; ok {
			continue
		}

		remainingServiceNames = append(remainingServiceNames, serviceName)
	}
	sort.Strings(remainingServiceNames)

	return append(orderedNames, remainingServiceNames...)
}

func readServiceURLs(service ResolvedService, httpsPort int) []string {
	if urls := readManagedServiceURLs(service, httpsPort); len(urls) > 0 {
		return urls
	}

	if service.Port == nil {
		return nil
	}

	proxyHost, err := caddy.ResolveProxyHost(service.BindHost)
	if err != nil {
		return nil
	}

	return []string{fmt.Sprintf("http://%s", caddy.FormatProxyAddress(proxyHost, *service.Port))}
}

type serviceStartOptions struct {
	ServiceName           string
	Exits                 chan<- serviceExitResult
	Stack                 StartStackOptions
	Environment           map[string]string
	Control               *devtools.ControlServer
	AllowPortReassignment bool
}

func startServiceWithRetries(ctx context.Context, manifest *ResolvedManifest, start serviceStartOptions) (*startedService, error) {
	serviceName, serviceExits, options, environment, devtoolsControlServer := start.ServiceName, start.Exits, start.Stack, start.Environment, start.Control
	service, ok := manifest.Services[serviceName]
	if !ok {
		return nil, fmt.Errorf("unknown service: %s", serviceName)
	}
	if usesDaemonLifecycle(service) {
		return nil, fmt.Errorf("service %s uses daemon lifecycle and must not start as a foreground process", serviceName)
	}

	retryCount := 0

	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		service, ok := manifest.Services[serviceName]
		if !ok {
			return nil, fmt.Errorf("unknown service: %s", serviceName)
		}
		if err := validateAssignedAutoPort(service); err != nil {
			if !start.AllowPortReassignment || !ShouldRetryAutoPortStartup(service, err, nil, retryCount) {
				return nil, err
			}
			retryCount++
			if err := reassignStartupAutoPort(manifest, serviceName, options.LogWriter); err != nil {
				return nil, err
			}
			continue
		}

		attemptOutput := &attemptOutputLines{}
		started, err := startServiceProcess(*manifest, service, processStartOptions{
			attemptOutput: attemptOutput,
			environment:   environment,
			onStderrLine: func(line string) {
				if devtoolsControlServer != nil {
					devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStderr, line)
				}
			},
			onStdoutLine: func(line string) {
				if devtoolsControlServer != nil {
					devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStdout, line)
				}
			},
			stderrWriter: options.ServiceStderrWriter,
			stdoutWriter: options.ServiceStdoutWriter,
		})
		if err != nil {
			return nil, err
		}

		var lastProgressLog time.Time
		var lastAmbiguityWarning time.Time

		err = WaitForServiceHealth(ctx, WaitForServiceHealthOptions{
			Health:       service.Health,
			ReadExitCode: started.ReadExitCode,
			ServiceName:  service.Name,
			OnProgress: func(attempts int, elapsed time.Duration) {
				now := time.Now()
				if elapsed >= 2*time.Second && (lastProgressLog.IsZero() || now.Sub(lastProgressLog) >= 5*time.Second) {
					lastProgressLog = now
					address := ""
					if service.Health.Host != nil && service.Health.Port != nil {
						address = fmt.Sprintf(" on %s:%d", *service.Health.Host, *service.Health.Port)
					} else if service.Health.URL != nil {
						address = fmt.Sprintf(" on %s", *service.Health.URL)
					}
					writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Waiting for service %s to pass its health check%s (elapsed: %s)...", service.Name, address, elapsed.Round(time.Second)))

					if service.Health.Kind == "tcp" && service.Health.Host != nil && service.Health.Port != nil && (lastAmbiguityWarning.IsZero() || now.Sub(lastAmbiguityWarning) >= 10*time.Second) {
						altBindHost := readAlternativeBindHost(*service.Health.Host)
						if altBindHost != "" {
							proxyHost, err := caddy.ResolveProxyHost(altBindHost)
							if err == nil && proxyHost != "" {
								if canConnectToPort(ctx, proxyHost, *service.Health.Port, probeTimeoutFor(service.Health)) {
									lastAmbiguityWarning = now
									writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf(
										"WARNING: Service %s is not responding on %s:%d, but accepted a connection on %s:%d! Consider setting services.%s.bindHost = %q in your manifest.",
										service.Name, *service.Health.Host, *service.Health.Port, altBindHost, *service.Health.Port, service.Name, altBindHost,
									))
								}
							}
						}
					}
				}
			},
		})
		if err == nil {
			if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.Global.HTTPSPort); warning != "" {
				writeLogLine(options.LogWriter, manifest.Name, warning)
			}

			go func(startedService *startedService) {
				<-startedService.exited
				if devtoolsControlServer != nil {
					_ = devtoolsControlServer.PublishHealthResponse()
				}
				if startedService.isRestartingValue() {
					return
				}
				select {
				case serviceExits <- serviceExitResult{exitCode: startedService.exitCodeValue(), serviceName: startedService.service.Name}:
				default:
				}
			}(started)
			if devtoolsControlServer != nil {
				_ = devtoolsControlServer.PublishHealthResponse()
			}

			return started, nil
		}

		// stopStartedService signals the whole contained process tree and then waits for exit and for the output readers
		// to drain, so attemptOutput is complete below. Waiting before it could block on a surviving descendant that
		// still holds the inherited output pipe.
		exitedBeforeCleanup := started.ReadExitCode() != nil
		if stopError := stopStartedService(started, resolveGracePeriod(options.ShutdownGracePeriod)); stopError != nil {
			return nil, joinCleanupError(err, stopError)
		}
		if devtoolsControlServer != nil {
			_ = devtoolsControlServer.PublishHealthResponse()
		}

		isBindCollision := ShouldRetryAutoPortStartup(service, err, attemptOutput.snapshot(), retryCount)
		if isBindCollision && !start.AllowPortReassignment {
			return nil, assignedAutoPortConflict(service, err)
		}
		if !isBindCollision {
			if exitedBeforeCleanup {
				return started, err
			}
			return nil, err
		}

		retryCount += 1
		if err := reassignStartupAutoPort(manifest, serviceName, options.LogWriter); err != nil {
			return nil, err
		}
	}
}

func reassignStartupAutoPort(m *ResolvedManifest, serviceName string, logWriter io.Writer) error {
	writeLogLine(logWriter, m.Name, fmt.Sprintf("retrying %s with a new auto port after a bind collision.", serviceName))
	_, next, err := ReassignAutoPort(*m, serviceName)
	if err != nil {
		return err
	}
	*m = next
	return nil
}

func startDaemonLifecycleService(
	ctx context.Context,
	manifest *ResolvedManifest,
	serviceName string,
	options StartStackOptions,
	environment map[string]string,
	devtoolsControlServer *devtools.ControlServer,
) error {
	service, ok := manifest.Services[serviceName]
	if !ok {
		return fmt.Errorf("unknown service: %s", serviceName)
	}
	if !usesDaemonLifecycle(service) {
		return fmt.Errorf("service %s does not use daemon lifecycle", serviceName)
	}

	running, err := readDaemonLifecycleStatus(ctx, *manifest, service, environment, options, devtoolsControlServer)
	if err != nil {
		return err
	}
	if !running {
		if err := runServiceCommand(ctx, *manifest, service, service.Lifecycle.Start, "daemon start", environment, options, devtoolsControlServer); err != nil {
			return err
		}
	}

	var lastProgressLog time.Time
	var lastAmbiguityWarning time.Time

	err = WaitForServiceHealth(ctx, WaitForServiceHealthOptions{
		Health:      service.Health,
		ServiceName: service.Name,
		OnProgress: func(attempts int, elapsed time.Duration) {
			now := time.Now()
			if elapsed >= 2*time.Second && (lastProgressLog.IsZero() || now.Sub(lastProgressLog) >= 5*time.Second) {
				lastProgressLog = now
				address := ""
				if service.Health.Host != nil && service.Health.Port != nil {
					address = fmt.Sprintf(" on %s:%d", *service.Health.Host, *service.Health.Port)
				} else if service.Health.URL != nil {
					address = fmt.Sprintf(" on %s", *service.Health.URL)
				}
				writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Waiting for service %s to pass its health check%s (elapsed: %s)...", service.Name, address, elapsed.Round(time.Second)))

				if service.Health.Kind == "tcp" && service.Health.Host != nil && service.Health.Port != nil && (lastAmbiguityWarning.IsZero() || now.Sub(lastAmbiguityWarning) >= 10*time.Second) {
					altBindHost := readAlternativeBindHost(*service.Health.Host)
					if altBindHost != "" {
						proxyHost, err := caddy.ResolveProxyHost(altBindHost)
						if err == nil && proxyHost != "" {
							if canConnectToPort(ctx, proxyHost, *service.Health.Port, probeTimeoutFor(service.Health)) {
								lastAmbiguityWarning = now
								writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf(
									"WARNING: Service %s is not responding on %s:%d, but accepted a connection on %s:%d! Consider setting services.%s.bindHost = %q in your manifest.",
									service.Name, *service.Health.Host, *service.Health.Port, altBindHost, *service.Health.Port, service.Name, altBindHost,
								))
							}
						}
					}
				}
			}
		},
	})
	if err != nil {
		return err
	}
	if devtoolsControlServer != nil {
		_ = devtoolsControlServer.PublishHealthResponse()
	}
	return nil
}

func stopDaemonLifecycleService(
	manifest ResolvedManifest,
	service ResolvedService,
	options StartStackOptions,
	environment map[string]string,
	devtoolsControlServer *devtools.ControlServer,
) error {
	if !usesDaemonLifecycle(service) {
		return nil
	}

	if len(service.Lifecycle.Status) > 0 {
		running, err := readDaemonLifecycleStatus(context.Background(), manifest, service, environment, options, devtoolsControlServer)
		if err != nil {
			return err
		}
		if !running {
			return nil
		}
	}

	if err := runServiceCommand(context.Background(), manifest, service, service.Lifecycle.Stop, "daemon stop", environment, options, devtoolsControlServer); err != nil {
		return err
	}
	if devtoolsControlServer != nil {
		_ = devtoolsControlServer.PublishHealthResponse()
	}
	return nil
}

func stopDaemonLifecycleServices(
	manifest ResolvedManifest,
	startedServices []daemonLifecycleService,
	options StartStackOptions,
	environment map[string]string,
	devtoolsControlServer *devtools.ControlServer,
) error {
	var cleanupError error

	for index := len(startedServices) - 1; index >= 0; index-- {
		cleanupError = appendCleanupError(cleanupError, stopDaemonLifecycleService(manifest, startedServices[index].service, options, environment, devtoolsControlServer))
	}

	return cleanupError
}

func readDaemonLifecycleStatus(
	ctx context.Context,
	manifest ResolvedManifest,
	service ResolvedService,
	environment map[string]string,
	options StartStackOptions,
	devtoolsControlServer *devtools.ControlServer,
) (bool, error) {
	if len(service.Lifecycle.Status) == 0 {
		return false, nil
	}

	err := runServiceCommand(ctx, manifest, service, service.Lifecycle.Status, "daemon status", environment, options, devtoolsControlServer)
	if err == nil {
		return true, nil
	}

	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return false, nil
	}

	return false, err
}

func runServiceCommand(
	ctx context.Context,
	manifest ResolvedManifest,
	service ResolvedService,
	commandArgs []string,
	commandLabel string,
	environment map[string]string,
	options StartStackOptions,
	devtoolsControlServer *devtools.ControlServer,
) error {
	if len(commandArgs) == 0 {
		return fmt.Errorf("service %s %s command is empty", service.Name, commandLabel)
	}

	command := exec.CommandContext(ctx, commandArgs[0], commandArgs[1:]...)
	command.Dir = service.Cwd
	command.Env = createChildEnvironment(environment, service.Env, CreateInjectedServiceEnvironment(manifest, service))
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if err := syscall.Kill(-command.Process.Pid, syscall.SIGTERM); err == nil {
			return nil
		}
		return command.Process.Signal(syscall.SIGTERM)
	}

	stdoutWriter := newLifecycleCommandOutputWriter(
		fmt.Sprintf("[%s] ", service.Name),
		resolveStdoutWriter(options.ServiceStdoutWriter),
		func(line string) {
			if devtoolsControlServer != nil {
				devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStdout, line)
			}
		},
	)
	stderrWriter := newLifecycleCommandOutputWriter(
		fmt.Sprintf("[%s] ", service.Name),
		resolveStderrWriter(options.ServiceStderrWriter),
		func(line string) {
			if devtoolsControlServer != nil {
				devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStderr, line)
			}
		},
	)

	command.Stdout = stdoutWriter
	command.Stderr = stderrWriter
	command.WaitDelay = lifecycleCommandWaitDelay

	if err := command.Start(); err != nil {
		return fmt.Errorf("start service %s %s command: %w", service.Name, commandLabel, err)
	}

	err := command.Wait()
	stdoutWriter.Flush()
	stderrWriter.Flush()
	if err != nil && !errors.Is(err, exec.ErrWaitDelay) {
		return fmt.Errorf("wait for service %s %s command: %w", service.Name, commandLabel, err)
	}

	return nil
}

func startServiceProcess(manifest ResolvedManifest, service ResolvedService, options processStartOptions) (*startedService, error) {
	if len(service.Command) == 0 {
		return nil, fmt.Errorf("service %s command is empty", service.Name)
	}
	if err := validateServiceWorkingDirectory(service); err != nil {
		return nil, err
	}

	serviceContainmentToken := createServiceContainmentToken()
	command := exec.Command(service.Command[0], service.Command[1:]...)
	command.Dir = service.Cwd
	command.Env = createChildEnvironment(
		options.environment,
		service.Env,
		CreateInjectedServiceEnvironment(manifest, service),
		map[string]string{serviceContainmentTokenEnvironment: serviceContainmentToken},
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// The parent owns the read ends instead of using Cmd.StdoutPipe/StderrPipe: Cmd.Wait closes those as soon as the
	// process exits, discarding output still buffered in the pipe (such as the bind-collision line an auto-port retry
	// depends on). Wait never closes caller-provided files, so the readers drain every line to EOF.
	stdout, err := newServiceOutputPipe()
	if err != nil {
		return nil, fmt.Errorf("create stdout pipe for service %s: %w", service.Name, err)
	}

	stderr, err := newServiceOutputPipe()
	if err != nil {
		stdout.close()
		return nil, fmt.Errorf("create stderr pipe for service %s: %w", service.Name, err)
	}

	command.Stdout = stdout.writer
	command.Stderr = stderr.writer

	if err := prepareServiceContainment(); err != nil {
		stdout.close()
		stderr.close()
		return nil, fmt.Errorf("prepare service %s containment: %w", service.Name, err)
	}

	startError := command.Start()
	// The child holds its own copies of the write ends; closing the parent's lets the readers see EOF once the
	// service (and any descendant that inherited them) is gone.
	stdout.closeWriter()
	stderr.closeWriter()
	if startError != nil {
		stdout.close()
		stderr.close()
		return nil, fmt.Errorf("start service %s: cannot launch executable %q in working directory %q: %w", service.Name, command.Path, service.Cwd, startError)
	}

	containment, err := startServiceContainment(command.Process.Pid, serviceContainmentToken)
	if err != nil {
		serviceSignalSender(command, syscall.Signal(9))
		_ = command.Wait()
		stdout.close()
		stderr.close()
		return nil, fmt.Errorf("start service %s containment: %w", service.Name, err)
	}

	startedService := &startedService{
		cmd:         command,
		containment: containment,
		service:     service,
		exited:      make(chan struct{}),
	}

	startedService.outputWG.Add(2)
	go pipeServiceOutput(stdout.reader, fmt.Sprintf("[%s] ", service.Name), resolveStdoutWriter(options.stdoutWriter), options.attemptOutput, options.onStdoutLine, &startedService.outputWG)
	go pipeServiceOutput(stderr.reader, fmt.Sprintf("[%s] ", service.Name), resolveStderrWriter(options.stderrWriter), options.attemptOutput, options.onStderrLine, &startedService.outputWG)
	go startedService.waitForExit()

	return startedService, nil
}

func stopStartedService(startedService *startedService, gracePeriod time.Duration) error {
	if startedService == nil {
		return nil
	}
	defer startedService.closeContainment()

	signalStartedService(startedService, syscall.Signal(15))
	if waitForStartedServiceShutdownWithinGracePeriod(startedService, gracePeriod) {
		startedService.wait()
		return nil
	}

	signalStartedService(startedService, syscall.Signal(9))
	_ = waitForStartedServiceShutdownWithinGracePeriod(startedService, gracePeriod)
	startedService.wait()
	return startedService.shutdownFailure()
}

func stopStartedServices(startedServices []*startedService, gracePeriod time.Duration) error {
	var cleanupError error

	for index := len(startedServices) - 1; index >= 0; index-- {
		startedService := startedServices[index]
		if startedService == nil {
			continue
		}

		signalStartedService(startedService, syscall.Signal(15))
	}

	for index := len(startedServices) - 1; index >= 0; index-- {
		startedService := startedServices[index]
		if startedService == nil {
			continue
		}

		if !waitForStartedServiceShutdownWithinGracePeriod(startedService, gracePeriod) {
			signalStartedService(startedService, syscall.Signal(9))
			_ = waitForStartedServiceShutdownWithinGracePeriod(startedService, gracePeriod)
		}

		startedService.wait()
		cleanupError = appendCleanupError(cleanupError, startedService.shutdownFailure())
		startedService.closeContainment()
	}

	return cleanupError
}

func forwardStartedServicesSignal(startedServices []*startedService, receivedSignal os.Signal) {
	for _, startedService := range startedServices {
		if startedService == nil {
			continue
		}

		signalStartedService(startedService, receivedSignal)
	}
}

func signalStartedService(startedService *startedService, signal os.Signal) {
	if startedService == nil {
		return
	}
	startedService.noteShutdownSignal(signal)

	includeRootProcessGroup := startedService.ReadExitCode() == nil
	if startedService.containment != nil {
		startedService.containment.signal(startedService.cmd, includeRootProcessGroup, signal)
		return
	}

	if includeRootProcessGroup {
		serviceSignalSender(startedService.cmd, signal)
	}
}

func waitForStartedServiceShutdownWithinGracePeriod(startedService *startedService, gracePeriod time.Duration) bool {
	if startedService == nil {
		return true
	}

	timer := time.NewTimer(resolveGracePeriod(gracePeriod))
	defer timer.Stop()
	ticker := time.NewTicker(shutdownPollInterval)
	defer ticker.Stop()

	for {
		startedService.handleLateListeners()
		if startedService.isStopped() {
			return true
		}

		select {
		case <-timer.C:
			startedService.handleLateListeners()
			return startedService.isStopped()
		case <-ticker.C:
		}
	}
}

func isTerminationSignal(signal os.Signal) (syscall.Signal, bool) {
	signalValue, ok := signal.(syscall.Signal)
	if !ok {
		return 0, false
	}

	switch signalValue {
	case syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM, syscall.SIGKILL:
		return signalValue, true
	default:
		return 0, false
	}
}

func waitForExitWithinGracePeriod(startedService *startedService, gracePeriod time.Duration) bool {
	if startedService == nil {
		return true
	}

	timer := time.NewTimer(resolveGracePeriod(gracePeriod))
	defer timer.Stop()

	select {
	case <-startedService.exited:
		return true
	case <-timer.C:
		return false
	}
}

func pipeProcessOutput(reader io.Reader, prefix string, writer io.Writer, attemptOutput *attemptOutputLines, onLine func(string), wg *sync.WaitGroup) {
	defer wg.Done()

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := prefix + scanner.Text()
		attemptOutput.append(line)
		_, _ = fmt.Fprintln(writer, line)
		if onLine != nil {
			onLine(line)
		}
	}

	if err := scanner.Err(); err != nil {
		attemptOutput.append(prefix + err.Error())
	}
}

func resolveStartStackPaths(paths caddy.Paths, environment map[string]string) (caddy.Paths, error) {
	if strings.TrimSpace(paths.StateDirectoryPath) != "" {
		return paths, nil
	}

	return caddy.CreateManagedCaddyPathsFromEnvironment(environment)
}

func resolveStdoutWriter(writer io.Writer) io.Writer {
	if writer != nil {
		return writer
	}

	return os.Stdout
}

func resolveStderrWriter(writer io.Writer) io.Writer {
	if writer != nil {
		return writer
	}

	return os.Stderr
}

func resolveGracePeriod(gracePeriod time.Duration) time.Duration {
	if gracePeriod > 0 {
		return gracePeriod
	}

	return shutdownGracePeriod
}

func readSignalExitCode(receivedSignal os.Signal) int {
	signalValue, ok := receivedSignal.(syscall.Signal)
	if !ok {
		return 1
	}

	exitCode, ok := signalExitCodes[signalValue]
	if !ok {
		return 1
	}

	return exitCode
}

func collectClaimedHosts(services map[string]ResolvedService) []string {
	hostsByName := map[string]struct{}{}
	hosts := []string{}

	for _, service := range services {
		for _, host := range service.Hosts {
			if _, ok := hostsByName[host]; ok {
				continue
			}
			hostsByName[host] = struct{}{}
			hosts = append(hosts, host)
		}
	}

	sort.Strings(hosts)
	return hosts
}

func hasEnabledDevtools(config manifest.DevtoolsConfig) bool {
	return config.Editor.Enabled || config.ExternalToolbars.Enabled || config.Minimap.Enabled || config.Status.Enabled
}

func resolveSupportedDevtoolsFeatures(config manifest.DevtoolsConfig, annotation manifest.ValidatedAnnotation) devtools.FeatureToggles {
	devtoolsEnabled := hasEnabledDevtools(config)
	hasAnnotationActions := len(annotation.Actions) > 0
	hasQueuedAnnotationActions := false
	for _, action := range annotation.Actions {
		if action.Kind == "agent" {
			hasQueuedAnnotationActions = true
			break
		}
	}

	return devtools.FeatureToggles{
		AnnotationEnabled:       devtoolsEnabled && hasAnnotationActions,
		AnnotationQueueEnabled:  devtoolsEnabled && hasQueuedAnnotationActions,
		EditorEnabled:           config.Editor.Enabled,
		ExternalToolbarsEnabled: config.ExternalToolbars.Enabled,
		MinimapEnabled:          config.Minimap.Enabled,
		StatusEnabled:           config.Status.Enabled,
		TerminalEnabled:         devtoolsEnabled,
	}
}

func hasEnabledRuntimeDevtools(features devtools.FeatureToggles) bool {
	return features.AnnotationEnabled ||
		features.AnnotationQueueEnabled ||
		features.EditorEnabled ||
		features.ExternalToolbarsEnabled ||
		features.MinimapEnabled ||
		features.StatusEnabled ||
		features.TerminalEnabled
}

func collectRoutedServiceIdentities(services map[string]ResolvedService) []devtools.RoutedServiceIdentity {
	routedServices := []devtools.RoutedServiceIdentity{}
	for _, service := range services {
		if len(service.Hosts) == 0 {
			continue
		}

		path := "/"
		if service.Path != nil {
			path = *service.Path
		}

		for _, host := range service.Hosts {
			routedServices = append(routedServices, devtools.RoutedServiceIdentity{
				Host:        host,
				Path:        path,
				ServiceName: service.Name,
			})
		}
	}

	sort.Slice(routedServices, func(left int, right int) bool {
		if routedServices[left].Host != routedServices[right].Host {
			return routedServices[left].Host < routedServices[right].Host
		}
		if routedServices[left].Path != routedServices[right].Path {
			return routedServices[left].Path < routedServices[right].Path
		}
		return routedServices[left].ServiceName < routedServices[right].ServiceName
	})
	return routedServices
}

func isRootCompatibleServicePath(path *string) bool {
	return path == nil || *path == "/" || *path == "/*"
}

func collectServicesHealth(manifest ResolvedManifest, startedServices []*startedService, dirtyTracker *DirtyTracker) devtools.HealthResponse {
	startedServicesByName := map[string]*startedService{}
	for _, startedService := range startedServices {
		if startedService == nil {
			continue
		}
		startedServicesByName[startedService.service.Name] = startedService
	}

	serviceNames := append([]string{}, manifest.ServiceOrder...)
	if len(serviceNames) == 0 {
		for serviceName := range manifest.Services {
			serviceNames = append(serviceNames, serviceName)
		}
		sort.Strings(serviceNames)
	}

	services := make([]devtools.ServiceHealth, 0, len(serviceNames))
	for _, serviceName := range serviceNames {
		service, ok := manifest.Services[serviceName]
		if !ok {
			continue
		}

		status := false
		startedService := startedServicesByName[service.Name]
		managed := isManagedService(service)
		if !managed {
			status = CheckServiceHealth(service.Health)
		} else if usesDaemonLifecycle(service) {
			status = CheckServiceHealth(service.Health)
		} else if startedService != nil && startedService.ReadExitCode() == nil {
			status = CheckServiceHealth(service.Health)
		}

		dirty := false
		if dirtyTracker != nil {
			dirty = dirtyTracker.IsDirty(service.Name)
		}

		restarting := false
		var exitCode *int
		if startedService != nil {
			restarting = startedService.isRestartingValue()
			exitCode = startedService.unexpectedExitCode()
		}

		services = append(services, devtools.ServiceHealth{
			Managed:    managed,
			Name:       service.Name,
			Status:     status,
			URL:        readManagedServiceURL(service, manifest.Caddy.Global.HTTPSPort),
			Dirty:      dirty,
			Restarting: restarting,
			ExitCode:   exitCode,
		})
	}

	return devtools.HealthResponse{Services: services}
}

func isManagedService(service ResolvedService) bool {
	return service.Managed || len(service.Command) > 0
}

func usesDaemonLifecycle(service ResolvedService) bool {
	return service.Lifecycle.Mode == "daemon"
}

func hasStartedDaemonLifecycleService(startedServices []daemonLifecycleService, serviceName string) bool {
	for _, startedService := range startedServices {
		if startedService.service.Name == serviceName {
			return true
		}
	}

	return false
}

func upsertStartedDaemonLifecycleService(startedServices []daemonLifecycleService, service ResolvedService) []daemonLifecycleService {
	for index, startedService := range startedServices {
		if startedService.service.Name != service.Name {
			continue
		}

		startedServices[index] = daemonLifecycleService{service: service}
		return startedServices
	}

	return append(startedServices, daemonLifecycleService{service: service})
}

func readManagedServiceURL(service ResolvedService, httpsPort int) *string {
	urls := readManagedServiceURLs(service, httpsPort)
	if len(urls) == 0 {
		return nil
	}
	return &urls[0]
}

func readManagedServiceURLs(service ResolvedService, httpsPort int) []string {
	if len(service.Hosts) == 0 || service.Path == nil {
		return nil
	}

	normalizedPath := normalizeManagedServiceURLPath(*service.Path)
	urls := make([]string, 0, len(service.Hosts))
	for _, host := range service.Hosts {
		if normalizedPath == "/" {
			urls = append(urls, caddy.FormatManagedCaddySiteAddress("https", httpsPort, host))
		} else {
			urls = append(urls, caddy.CreateManagedCaddyURL("https", host, httpsPort, normalizedPath))
		}
	}
	return urls
}

func normalizeManagedServiceURLPath(path string) string {
	if path == "/" || path == "/*" {
		return "/"
	}

	if strings.HasSuffix(path, "/*") {
		return strings.TrimSuffix(path, "*")
	}

	return path
}

func findStartedService(startedServices []*startedService, serviceName string) *startedService {
	for _, startedService := range startedServices {
		if startedService != nil && startedService.service.Name == serviceName {
			return startedService
		}
	}

	return nil
}

func removeStartedService(startedServices []*startedService, target *startedService) []*startedService {
	for index, startedService := range startedServices {
		if startedService != target {
			continue
		}

		return append(startedServices[:index], startedServices[index+1:]...)
	}

	return startedServices
}

func readCurrentEnvironment() map[string]string {
	environment := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}

		environment[key] = value
	}

	return environment
}

func createServiceContainmentToken() string {
	return fmt.Sprintf("%d-%d", os.Getpid(), serviceContainmentTokenCounter.Add(1))
}

func copyEnvironment(value map[string]string) map[string]string {
	copyValue := map[string]string{}
	for key, item := range value {
		copyValue[key] = item
	}

	return copyValue
}

func createChildEnvironment(base map[string]string, values ...map[string]string) []string {
	environment := copyEnvironment(base)
	for _, value := range values {
		for key, item := range value {
			environment[key] = item
		}
	}

	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+environment[key])
	}

	return result
}

func writeLogLine(writer io.Writer, label string, message string) {
	if writer == nil {
		return
	}

	trimmedLabel := strings.TrimSpace(label)
	if trimmedLabel == "" {
		trimmedLabel = defaultLogLabel
	}

	_, _ = fmt.Fprintf(writer, "[%s] %s\n", trimmedLabel, message)
}

func joinCleanupError(runError error, cleanupError error) error {
	if cleanupError == nil {
		return runError
	}

	if runError == nil {
		return cleanupError
	}

	return errors.Join(runError, fmt.Errorf("cleanup: %w", cleanupError))
}

func appendCleanupError(existing error, next error) error {
	if next == nil {
		return existing
	}

	if existing == nil {
		return next
	}

	return errors.Join(existing, next)
}

func formatShutdownPIDList(pids []int) string {
	parts := make([]string, 0, len(pids))
	for _, pid := range pids {
		parts = append(parts, fmt.Sprintf("%d", pid))
	}

	return strings.Join(parts, ", ")
}

func formatServiceListenerAddress(bindHost string, port int) string {
	if bindHost == "" {
		return fmt.Sprintf("port %d", port)
	}

	return net.JoinHostPort(bindHost, fmt.Sprintf("%d", port))
}

func sendSignal(command *exec.Cmd, signal os.Signal) {
	if command == nil || command.Process == nil {
		return
	}

	if signalValue, ok := signal.(syscall.Signal); ok && command.Process.Pid > 0 {
		if err := syscall.Kill(-command.Process.Pid, signalValue); err == nil {
			return
		}
	}

	_ = command.Process.Signal(signal)
}

func (s *startedService) waitForExit() {
	err := s.cmd.Wait()
	exitCode := -1
	if s.cmd.ProcessState != nil {
		exitCode = s.cmd.ProcessState.ExitCode()
	}
	if err != nil && s.cmd.ProcessState == nil {
		exitCode = 1
	}

	s.exitMu.Lock()
	s.exitCode = exitCode
	s.hasExited = true
	s.exitMu.Unlock()
	close(s.exited)
}

func (s *startedService) wait() {
	<-s.exited
	s.outputWG.Wait()
}

func (s *startedService) closeContainment() {
	if s == nil || s.containment == nil {
		return
	}

	s.containment.close()
	s.containment = nil
}

func (s *startedService) shutdownFailure() error {
	if s == nil {
		return nil
	}

	problems := []string{}
	if s.ReadExitCode() == nil && s.cmd != nil && s.cmd.Process != nil {
		problems = append(problems, fmt.Sprintf("root process is still running (pid %d)", s.cmd.Process.Pid))
	}

	if s.containment != nil {
		descendantPIDs := s.containment.tracker.liveDescendantPIDs()
		if len(descendantPIDs) > 0 {
			problems = append(problems, fmt.Sprintf("live descendant pids: %s", formatShutdownPIDList(descendantPIDs)))
		}
	}

	if s.service.Port != nil {
		listenerPIDs := s.ownedListenerPIDs()
		if len(listenerPIDs) > 0 {
			problems = append(problems, fmt.Sprintf("listener still active on %s (pids: %s)", formatServiceListenerAddress(s.service.BindHost, *s.service.Port), formatShutdownPIDList(listenerPIDs)))
		}
	}

	if len(problems) == 0 {
		return nil
	}

	return fmt.Errorf("failed to shut down service %s after SIGTERM and SIGKILL: %s", s.service.Name, strings.Join(problems, "; "))
}

func (s *startedService) isStopped() bool {
	if s == nil {
		return true
	}

	if s.ReadExitCode() == nil {
		return false
	}

	if s.containment == nil {
		return s.lateListenerMonitorSatisfied()
	}

	if s.containment.hasLiveDescendants() {
		return false
	}

	return s.lateListenerMonitorSatisfied()
}

func (s *startedService) noteShutdownSignal(signal os.Signal) {
	signalValue, ok := isTerminationSignal(signal)
	if !ok {
		return
	}

	s.shutdownMu.Lock()
	defer s.shutdownMu.Unlock()
	if s.shutdownAt.IsZero() {
		s.shutdownAt = time.Now()
	}
	s.shutdownWith = signalValue
}

func (s *startedService) handleLateListeners() {
	if s == nil || s.service.Port == nil || s.ReadExitCode() == nil {
		return
	}

	now := time.Now()
	s.shutdownMu.Lock()
	if s.shutdownAt.IsZero() || (!s.lastLateListenerCheckAt.IsZero() && now.Sub(s.lastLateListenerCheckAt) < lateListenerPollInterval) {
		s.shutdownMu.Unlock()
		return
	}
	s.lastLateListenerCheckAt = now
	signalValue := s.shutdownWith
	s.shutdownMu.Unlock()

	listenerPIDs := s.ownedListenerPIDs()
	if len(listenerPIDs) == 0 {
		return
	}

	for _, pid := range listenerPIDs {
		if pid == os.Getpid() {
			continue
		}
		if err := syscall.Kill(pid, signalValue); err != nil && err != syscall.ESRCH {
			continue
		}
	}
}

func (s *startedService) ownedListenerPIDs() []int {
	if s.service.Port == nil {
		return nil
	}
	owned := map[int]bool{}
	if s.ReadExitCode() == nil && s.cmd != nil && s.cmd.Process != nil {
		owned[s.cmd.Process.Pid] = true
	}
	if s.containment != nil {
		for _, pid := range s.containment.tracker.liveDescendantPIDs() {
			owned[pid] = true
		}
	}
	var result []int
	for _, pid := range readListeningProcessIDs(s.service.BindHost, *s.service.Port) {
		if owned[pid] {
			result = append(result, pid)
		}
	}
	return result
}

func (s *startedService) lateListenerMonitorSatisfied() bool {
	if s == nil || s.service.Port == nil {
		return true
	}

	s.shutdownMu.Lock()
	shutdownAt := s.shutdownAt
	s.shutdownMu.Unlock()
	if shutdownAt.IsZero() {
		return true
	}

	return time.Since(shutdownAt) >= lateListenerMonitorDuration
}

func (s *startedService) exitCodeValue() int {
	s.exitMu.Lock()
	defer s.exitMu.Unlock()
	return s.exitCode
}

func (s *startedService) ReadExitCode() *int {
	s.exitMu.Lock()
	defer s.exitMu.Unlock()
	if !s.hasExited {
		return nil
	}

	exitCode := s.exitCode
	return &exitCode
}

func (s *startedService) setRestarting(value bool) {
	s.restartMu.Lock()
	defer s.restartMu.Unlock()
	if value {
		s.exitedBeforeRestart = s.ReadExitCode() != nil
	}
	s.isRestarting = value
}

func (s *startedService) unexpectedExitCode() *int {
	s.restartMu.Lock()
	defer s.restartMu.Unlock()
	if s.isRestarting && !s.exitedBeforeRestart {
		return nil
	}
	return s.ReadExitCode()
}

func (s *startedService) isRestartingValue() bool {
	s.restartMu.Lock()
	defer s.restartMu.Unlock()
	return s.isRestarting
}
