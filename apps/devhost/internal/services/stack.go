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
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devbuild"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
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
	// File sessions own their backend and report unexpected listener failures.
	runtimeErrors      <-chan error
	serveSession       bool
	Configuration      *manifest.Manifest
	CaddyOutputWriters caddy.RouteCommandOutputWriters
	CaddyPaths         caddy.Paths
	// ConfigPath names the devhost config file the stack applies and watches;
	// empty resolves it from Environment.
	ConfigPath          string
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

	worktrees, err := newStackWorktrees(*manifest, paths.StateDirectoryPath)
	if err != nil {
		return 0, err
	}
	initial, blocked := worktrees.restore(*manifest)
	*manifest = initial
	if initial.configuration != nil {
		options.Configuration = initial.configuration
		serviceOrder, err = ResolveServiceOrder(*initial.configuration)
		if err != nil {
			return 0, err
		}
		if len(blocked) == 0 {
			worktrees, err = buildStackWorktrees(initial, paths.StateDirectoryPath, worktrees)
			if err != nil {
				return 0, err
			}
		}
	}
	lifecycleCtx, cancelLifecycle := context.WithCancel(context.Background())
	defer cancelLifecycle()
	state := &stackRuntime{
		manifestFiles: stackManifestFiles(options.Configuration),
		starting:      map[string]bool{}, failures: map[string]string{},
		configured: options.Configuration,
		manifest:   manifest, order: append([]string{}, serviceOrder...), options: options, environment: environment,
		gracePeriod: gracePeriod, worktrees: worktrees, blocked: blocked, failedRoutes: map[string]*startedService{},
		exits: make(chan serviceExitResult, len(serviceOrder)),
	}
	signalExits := make(chan os.Signal, 1)
	runtimeErrors := make(chan error, 1)
	documentInjectionServers := map[string]*devtools.DocumentInjectionServer{}
	var devtoolsControlServer *devtools.ControlServer
	var cleanupError error
	shutdownProgress := newShutdownProgress(options.LogWriter, state.stackName)
	routes := stackRoutes{manifest: *manifest, paths: paths, outputWriters: options.CaddyOutputWriters, documentServers: documentInjectionServers, active: map[string]caddy.ActivateRouteOptions{}}
	routes.runtime = state
	routes.restartService = func(name string) error { return state.restart(lifecycleCtx, []string{name}) }
	for name, service := range manifest.Services {
		if isManagedService(service) {
			state.starting[name] = true
		}
	}

	dirtyTracker := NewDirtyTracker()
	onDirty := func(serviceName string) {
		state.publish()
	}
	watchManager := NewWatchManager(dirtyTracker, onDirty, options.LogWriter, state.stackName)
	state.watcher, state.dirty, state.routes = watchManager, dirtyTracker, &routes

	defer watchManager.StopAll()
	for _, s := range manifest.Services {
		if len(s.Watch) > 0 && blocked[s.Name] == "" {
			if err := watchManager.StartWatching(s.Name, s.Watch, s.Cwd); err != nil {
				return 0, fmt.Errorf("failed to start watching for service %s: %w", s.Name, err)
			}
		}
	}

	configPath := options.ConfigPath
	if configPath == "" {
		if configPath, err = config.Path(environment); err != nil {
			return 0, err
		}
	}
	state.configPath = configPath
	shared, err := config.Read(configPath)
	if err != nil {
		return 0, err
	}
	processSignals := make(chan os.Signal, 1)
	registerProcessSignals(processSignals)
	defer unregisterProcessSignals(processSignals)
	signalForwardingDone := make(chan struct{})
	go func() {
		defer close(signalForwardingDone)
		select {
		case receivedSignal := <-processSignals:
			cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("Received %s; shutting down the stack.", describeShutdownSignal(receivedSignal)))
			signalExits <- receivedSignal
			cancelLifecycle()
		case err := <-options.runtimeErrors:
			runtimeErrors <- err
			cancelLifecycle()
		case <-lifecycleCtx.Done():
		}
	}()
	defer func() {
		cancelLifecycle()
		<-signalForwardingDone
		if errors.Is(returnedError, context.Canceled) && cleanupError == nil {
			select {
			case sig := <-signalExits:
				exitCode, returnedError = readSignalExitCode(sig), nil
			case err := <-runtimeErrors:
				returnedError = err
			default:
			}
		}
	}()

	defer func() {
		cancelLifecycle()
		state.operationMu.Lock()
		state.shuttingDown = true
		wasReady := state.ready
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
		for _, started := range startedServicesSnapshot {
			if started != nil {
				shutdownProgress.stopping(started.service.Name)
			}
		}
		cleanupError = appendCleanupError(cleanupError, stopStartedServices(startedServicesSnapshot, gracePeriod, shutdownProgress.stopped))
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
			cleanupError = appendCleanupError(cleanupError, caddy.UnregisterRoute(route.ServiceName, route.Host, route.Path, manifest.ManifestPath, paths.RegistrationsDirectoryPath, options.CaddyOutputWriters))
		}

		for _, host := range state.claimedHosts {
			cleanupError = appendCleanupError(cleanupError, caddy.SyncManagedHostRoute(host, paths.RoutesDirectoryPath, options.CaddyOutputWriters))
		}

		for _, claim := range state.claimedFixedPorts {
			cleanupError = appendCleanupError(cleanupError, caddy.ReleaseFixedPortClaim(caddy.ClaimFixedPortOptions{
				BindHost:                claim.bindHost,
				ManifestPath:            manifest.ManifestPath,
				Port:                    claim.port,
				PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
			}))
		}

		// Last, so the stack stays known to devhost stop and devhost stack list
		// for as long as anything of it is left to stop.
		cleanupError = appendCleanupError(cleanupError, caddy.UnregisterStack(paths.StacksDirectoryPath))

		if cleanupError != nil {
			returnedError = joinCleanupError(returnedError, cleanupError)
		} else if wasReady || len(startedServicesSnapshot) > 0 || len(startedDaemonServicesSnapshot) > 0 {
			cliout.Log(options.LogWriter, manifest.Name, "Stack stopped.")
		}
	}()

	if err := caddy.EnsureManagedCaddyConfig(paths, shared.Caddy, runtime.GOOS); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}

	if err := caddy.CleanupStaleStackRecords(paths.StacksDirectoryPath); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	if err := caddy.RegisterStack(caddy.RegisterStackOptions{
		ManifestFiles:       stackManifestFiles(options.Configuration),
		ManifestPath:        manifest.ManifestPath,
		StackName:           manifest.Name,
		StacksDirectoryPath: paths.StacksDirectoryPath,
	}); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}

	if err := caddy.CleanupStaleRegistrations(paths.RegistrationsDirectoryPath); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	if err := caddy.CleanupStaleFixedPortClaims(paths.PortClaimsDirectoryPath); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	if err := ensureManagedCaddyRunning(paths, shared.Caddy, options, manifest.Name); err != nil {
		return 0, joinCleanupError(err, cleanupError)
	}
	// Starting a stack applies the devhost config file, so an edit made while no
	// stack watched it takes effect now.
	if _, err := caddy.ApplyManagedCaddySettings(paths, shared.Caddy, options.CaddyOutputWriters); err != nil {
		return 0, joinCleanupError(fmt.Errorf("apply the devhost config file %s: %w", configPath, err), cleanupError)
	}
	manifest.Caddy = shared.Caddy
	routes.manifest = *manifest

	zombieCleanup := new(caddy.ZombieCleanup)
	for _, service := range manifest.Services {
		if service.PortSource != "fixed" || service.Port == nil {
			continue
		}

		if err := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
			ZombieCleanup:           zombieCleanup,
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
			ZombieCleanup:              zombieCleanup,
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

	// The control server runs for the stack's whole life, whatever the devtools
	// settings, so a reload that turns them on or off keeps its sessions.
	{
		devSource, devSourceWarning, err := loadDevSourceCheckout(environment, manifest.ManifestDirectoryPath, devbuild.SourceDirectory())
		if err != nil {
			return 0, joinCleanupError(err, cleanupError)
		}
		if devSourceWarning != "" {
			cliout.Log(options.LogWriter, manifest.Name, cliout.Warning(devSourceWarning))
		}
		if devSource != nil {
			cliout.Log(options.LogWriter, manifest.Name, fmt.Sprintf("Rebuilding devtools assets on demand from source checkout: %s", devSource.RootPath()))
		}

		// The worktree picker calls through whether or not worktrees are on; the
		// runtime refuses it while they are off, and a reload can turn them on.
		switchWorktree := func(id, path string) error { return state.switchWorktree(lifecycleCtx, id, path) }
		settings := devtoolsControlSettings(*manifest)
		controlServer, err := startDevtoolsControlServer(devtools.StartControlServerOptions{
			ChatPrompt:    settings.ChatPrompt,
			NativeBrowser: settings.NativeBrowser,
			OwnsDocumentURL: func(port int, href string) (bool, error) {
				return caddy.AllowsDevtoolsURL(paths, caddy.DevtoolsRouteOwner{ManifestPath: manifest.ManifestPath, ControlPort: port}, href)
			},
			ComponentEditor: settings.ComponentEditor,
			DevSource:       devSource,
			OnLog: func(message string) {
				cliout.Log(options.LogWriter, state.stackName(), message)
			},
			FeatureToggles: settings.FeatureToggles,
			GetHealthResponse: func() (devtools.HealthResponse, error) {
				return state.health(lifecycleCtx)
			},
			Position:        settings.Position,
			ProjectRootPath: manifest.ManifestDirectoryPath,
			PrimaryService:  settings.PrimaryService,
			ResourceUsage: devtools.ResourceUsageOptions{
				Intervals: settings.ResourceIntervals,
				Readers:   hostusage.HostReaders(),
				OnFailure: func(readout string, err error) {
					cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("devtools %s usage is unavailable: %v", readout, err))
				},
			},
			RestartService:          func(names []string) error { return state.restart(lifecycleCtx, names) },
			StartService:            func(names []string) error { return state.startServices(lifecycleCtx, names) },
			RestartStack:            func() error { return state.restartStack(lifecycleCtx) },
			SwitchWorktree:          switchWorktree,
			RefreshWorktrees:        state.refreshWorktrees,
			StopWorktreeOwner:       state.stopWorktreeOwner,
			ListConfigFiles:         state.configFiles,
			CheckConfigFile:         state.checkConfigFile,
			GetToolContext:          state.toolContext,
			RestartServicesShortcut: settings.RestartServicesShortcut,
			RoutedServices:          settings.RoutedServices,
			StackName:               settings.StackName,
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
	// Publish every selected route before any child waits for health. The document
	// listener serves lifecycle state until both health and routing are ready.
	if err := routes.replace(*manifest); err != nil {
		return 0, joinCleanupError(err, cleanupError)
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
			if _, stopped := manifest.Stopped[serviceName]; stopped {
				continue
			}
			return 0, joinCleanupError(fmt.Errorf("unknown service: %s", serviceName), cleanupError)
		}

		if isManagedService(service) && blocked[serviceName] == "" {
			if groupedServices[serviceName] {
				if err := state.start(lifecycleCtx, serviceName, runtimeStartOptions{RefreshRoute: true, AllowPortReassignment: true}); err != nil {
					if lifecycleCtx.Err() != nil {
						return 0, err
					}
					if err := state.failWorktreeStartup(serviceName, err); err != nil {
						return 0, err
					}
				}
				service = manifest.Services[serviceName]
			} else {
				if err := state.start(lifecycleCtx, serviceName, runtimeStartOptions{RefreshRoute: true, AllowPortReassignment: true}); err != nil {
					if lifecycleCtx.Err() != nil {
						return 0, err
					}
					state.logFailure(serviceName, err)
					state.startedMu.Lock()
					started := findStartedService(state.started, serviceName)
					state.startedMu.Unlock()
					if started != nil && started.unexpectedExitCode() != nil {
						state.exits <- serviceExitResult{exitCode: *started.unexpectedExitCode(), serviceName: serviceName}
					}
				}
				service = manifest.Services[serviceName]
			}
		}

		if len(service.Hosts) == 0 || service.Port == nil {
			continue
		}

		if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.HTTPSPort); warning != "" {
			cliout.Log(options.LogWriter, manifest.Name, warning)
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
	logStoppedServices(*manifest, options.LogWriter)

	idle := newIdleWatch(devtoolsControlServer, caddy.AccessLogPath(paths, stackAccessLogName(*manifest)), options.LogWriter, state.stackName)
	state.idle = idle
	defer idle.stop()
	idle.set(resolveIdleTimeout(options.IdleTimeout, manifest.Devtools))

	var manifestEvents <-chan error
	var manifestWatch *manifestWatcher
	if state.configured != nil {
		manifestWatch, err = state.watchManifest()
		if err != nil {
			return 0, err
		}
		defer func() { returnedError = errors.Join(returnedError, manifestWatch.close()) }()
		manifestEvents = manifestWatch.events
		state.manifestWatch = manifestWatch
	}
	configWatch, err := watchSharedConfig(configPath)
	if err != nil {
		return 0, err
	}
	defer func() { returnedError = errors.Join(returnedError, configWatch.close()) }()
	configEvents := configWatch.events
	state.operationMu.Lock()
	state.ready = true
	state.operationMu.Unlock()
	state.manifestMu.Lock()
	state.startupComplete = true
	state.manifestMu.Unlock()
	var reloadResults, configResults <-chan error
	defer func() {
		cancelLifecycle()
		if reloadResults != nil {
			<-reloadResults
		}
		if configResults != nil {
			<-configResults
		}
	}()
	if manifestWatch != nil {
		// Configuration may have changed while the initial services started. The
		// check shares the watcher's debounce, so a save made meanwhile is applied
		// once.
		manifestWatch.check()
	}
	configWatch.check()
	for {
		select {
		case err := <-configEvents:
			completed := make(chan error, 1)
			configResults = completed
			configEvents = nil
			go func() {
				if err == nil {
					err = state.applySharedConfig(configPath, configWatch)
				}
				completed <- err
			}()
		case err := <-configResults:
			configResults = nil
			configEvents = configWatch.events
			if state.recordConfigurationResult(devtools.ConfigurationSourceConfig, err) && err != nil {
				cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("shared Caddy settings rejected: %v", err))
			}
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
			if state.recordConfigurationResult(devtools.ConfigurationSourceManifest, err) && err != nil {
				cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("configuration reload rejected: %v", err))
			}
		case result := <-state.exits:
			cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("%s exited with code %d; devhost is waiting for a restart.", result.serviceName, result.exitCode))
		case receivedSignal := <-signalExits:
			cancelLifecycle()
			state.startedMu.Lock()
			startedServicesSnapshot := append([]*startedService{}, state.started...)
			state.startedMu.Unlock()
			forwardStartedServicesSignal(startedServicesSnapshot, receivedSignal, shutdownProgress.stopping)
			return readSignalExitCode(receivedSignal), nil
		case err := <-runtimeErrors:
			return 0, err
		case timeout := <-idle.expired:
			cancelLifecycle()
			cliout.Log(options.LogWriter, state.stackName(), fmt.Sprintf("Idle timeout of %s reached. Automatically shutting down the stack...", timeout))
			state.startedMu.Lock()
			startedServicesSnapshot := append([]*startedService{}, state.started...)
			state.startedMu.Unlock()
			forwardStartedServicesSignal(startedServicesSnapshot, syscall.SIGTERM, shutdownProgress.stopping)
			return 0, nil
		}
	}
}

func describeShutdownSignal(sig os.Signal) string {
	name := sig.String()
	switch sig {
	case syscall.SIGINT:
		name = "SIGINT (Ctrl-C)"
	case syscall.SIGHUP:
		name = "SIGHUP"
	case syscall.SIGTERM:
		name = "SIGTERM"
	}
	if number, ok := sig.(syscall.Signal); ok {
		return fmt.Sprintf("%s (signal %d)", name, number)
	}
	return name
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

	for _, services := range []map[string]ResolvedService{manifest.Services, manifest.Stopped} {
		for _, otherService := range services {
			if otherService.Port != nil {
				envSafeName := toEnvSafeName(otherService.Name)
				environment["DEVHOST_PORT_"+envSafeName] = fmt.Sprintf("%d", *otherService.Port)
			}
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
		for _, serviceURL := range readServiceURLs(service, manifest.Caddy.HTTPSPort) {
			cliout.Log(writer, manifest.Name, fmt.Sprintf("%s: %s", displayName, serviceURL))
		}
	}
}

// logStoppedServices names the services a run that started only some of them left out.
func logStoppedServices(manifest ResolvedManifest, writer io.Writer) {
	if stopped := stoppedServiceNames(manifest); len(stopped) > 0 {
		cliout.Log(writer, manifest.Name, fmt.Sprintf("not started: %s", strings.Join(stopped, ", ")))
	}
}

// stoppedServiceNames returns the stopped services in manifest order.
func stoppedServiceNames(manifest ResolvedManifest) []string {
	var names []string
	for _, serviceName := range manifest.ServiceOrder {
		if _, ok := manifest.Stopped[serviceName]; ok && !slices.Contains(names, serviceName) {
			names = append(names, serviceName)
		}
	}

	var remaining []string
	for serviceName := range manifest.Stopped {
		if !slices.Contains(names, serviceName) {
			remaining = append(remaining, serviceName)
		}
	}
	sort.Strings(remaining)

	return append(names, remaining...)
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

		err = waitForStartupHealth(ctx, service, startupHealthOptions{
			stackName: manifest.Name, logWriter: options.LogWriter, readExitCode: started.ReadExitCode,
		})
		if err == nil {
			if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.HTTPSPort); warning != "" {
				cliout.Log(options.LogWriter, manifest.Name, warning)
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

		if ctx.Err() != nil {
			// Lifecycle cancellation enters stack shutdown. Retain ownership of the
			// child so centralized cleanup announces and verifies its termination.
			return started, ctx.Err()
		}

		// stopStartedService signals the whole contained process tree and then waits for exit and for the output readers
		// to drain, so attemptOutput is complete below. Waiting before it could block on a surviving descendant that
		// still holds the inherited output pipe.
		exitedBeforeCleanup := started.ReadExitCode() != nil
		if !exitedBeforeCleanup {
			cliout.Log(options.LogWriter, manifest.Name, fmt.Sprintf("%v Stopping service %s because its startup health check failed; sending SIGTERM (signal 15).", err, service.Name))
		}
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
	cliout.Log(logWriter, m.Name, fmt.Sprintf("retrying %s with a new auto port after a bind collision.", serviceName))
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

	err = waitForStartupHealth(ctx, service, startupHealthOptions{
		stackName: manifest.Name, logWriter: options.LogWriter,
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
	progress := newShutdownProgress(options.LogWriter, func() string { return manifest.Name })

	for index := len(startedServices) - 1; index >= 0; index-- {
		service := startedServices[index].service
		progress.stopping(service.Name)
		err := stopDaemonLifecycleService(manifest, service, options, environment, devtoolsControlServer)
		cleanupError = appendCleanupError(cleanupError, err)
		progress.stopped(service.Name, err)
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
		cliout.Prefix(nil, service.Name),
		resolveStdoutWriter(options.ServiceStdoutWriter),
		func(line string) {
			if devtoolsControlServer != nil {
				devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStdout, line)
			}
		},
	)
	stderrWriter := newLifecycleCommandOutputWriter(
		cliout.Prefix(nil, service.Name),
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
	go pipeServiceOutput(stdout.reader, cliout.Prefix(nil, service.Name), resolveStdoutWriter(options.stdoutWriter), options.attemptOutput, options.onStdoutLine, &startedService.outputWG)
	go pipeServiceOutput(stderr.reader, cliout.Prefix(nil, service.Name), resolveStderrWriter(options.stderrWriter), options.attemptOutput, options.onStderrLine, &startedService.outputWG)
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

func stopStartedServices(startedServices []*startedService, gracePeriod time.Duration, onStopped func(string, error)) error {
	var cleanupError error
	serviceErrors := map[string]error{}
	var stoppedNames []string

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
		err := startedService.shutdownFailure()
		cleanupError = appendCleanupError(cleanupError, err)
		startedService.closeContainment()
		name := startedService.service.Name
		if _, exists := serviceErrors[name]; !exists {
			stoppedNames = append(stoppedNames, name)
		}
		serviceErrors[name] = errors.Join(serviceErrors[name], err)
	}

	// A failed route replacement can leave two process trees for one service.
	// Report completion only after every tree belonging to that service is gone.
	if onStopped != nil {
		for _, name := range stoppedNames {
			onStopped(name, serviceErrors[name])
		}
	}

	return cleanupError
}

func forwardStartedServicesSignal(startedServices []*startedService, receivedSignal os.Signal, onStopping func(string)) {
	for _, startedService := range startedServices {
		if startedService == nil {
			continue
		}

		onStopping(startedService.service.Name)
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
		_ = cliout.WriteChildLine(writer, line)
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
	return config.Chat.Enabled || config.Annotations.Enabled || config.ConfigEditor.Enabled || config.Editor.Enabled || config.ExternalToolbars.Enabled || config.Minimap.Enabled || config.Status.Enabled
}

// devtoolsControlSettings are the settings of m the control server applies, at
// startup and after each accepted reload.
func devtoolsControlSettings(m ResolvedManifest) devtools.ControlSettings {
	return devtools.ControlSettings{
		ComponentEditor:         m.Devtools.Editor.IDE,
		FeatureToggles:          resolveSupportedDevtoolsFeatures(m.Devtools),
		ChatPrompt:              m.Devtools.Chat.Prompt,
		NativeBrowser:           m.Devtools.Browser,
		Position:                m.Devtools.Status.Position,
		PrimaryService:          m.PrimaryService,
		ResourceIntervals:       resolveResourceIntervals(m.Devtools.Resources),
		RestartServicesShortcut: m.Devtools.Shortcuts.RestartServices,
		RoutedServices:          collectRoutedServiceIdentities(m.Services),
		StackName:               m.Name,
	}
}

func resolveSupportedDevtoolsFeatures(config manifest.DevtoolsConfig) devtools.FeatureToggles {
	return devtools.FeatureToggles{
		ChatEnabled:             config.Chat.Enabled,
		AnnotationEnabled:       config.Annotations.Enabled,
		ConfigEditorEnabled:     config.ConfigEditor.Enabled,
		EditorEnabled:           config.Editor.Enabled,
		ExternalToolbarsEnabled: config.ExternalToolbars.Enabled,
		MinimapEnabled:          config.Minimap.Enabled,
		StatusEnabled:           config.Status.Enabled,
	}
}

// resolveResourceIntervals returns the poll interval of every readout that is on; an off readout keeps zero.
func resolveResourceIntervals(config manifest.DevtoolsResourcesConfig) hostusage.Intervals {
	intervals := hostusage.Intervals{}
	if !config.Enabled {
		return intervals
	}
	if config.CPU.Enabled {
		intervals.CPU = config.CPU.PollInterval
	}
	if config.Memory.Enabled {
		intervals.Memory = config.Memory.PollInterval
	}
	if config.Disk.Enabled {
		intervals.Disk = config.Disk.PollInterval
	}

	return intervals
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
			URL:        readManagedServiceURL(service, manifest.Caddy.HTTPSPort),
			Dirty:      dirty,
			Restarting: restarting,
			ExitCode:   exitCode,
		})
	}

	var stoppedServices []devtools.StoppedService
	for _, serviceName := range stoppedServiceNames(manifest) {
		stoppedServices = append(stoppedServices, devtools.StoppedService{Name: serviceName})
	}

	return devtools.HealthResponse{Services: services, StoppedServices: stoppedServices}
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
