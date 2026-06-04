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
	defaultLogLabel              = "devhost"
	maxAttemptOutputLines        = 50
	shutdownGracePeriod          = 10 * time.Second
	lateListenerMonitorDuration  = 2 * time.Second
	lateListenerPollInterval     = 100 * time.Millisecond
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

	restartMu    sync.Mutex
	isRestarting bool
	exitMu       sync.Mutex
	exitCode     int
	hasExited    bool
	shutdownMu   sync.Mutex
	shutdownAt   time.Time
	shutdownWith syscall.Signal
	lastLateListenerCheckAt time.Time
}

type claimedFixedPort struct {
	bindHost string
	port     int
}

type activeRoute struct {
	host        string
	path        string
	serviceName string
}

type serviceExitResult struct {
	exitCode    int
	serviceName string
}

type processStartOptions struct {
	attemptOutputLines *[]string
	environment        map[string]string
	onStderrLine       func(string)
	onStdoutLine       func(string)
	stderrWriter       io.Writer
	stdoutWriter       io.Writer
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
	startedServices := []*startedService{}
	startedDaemonServices := []daemonLifecycleService{}
	var startedServicesMu sync.Mutex
	var startedDaemonServicesMu sync.Mutex
	claimedFixedPorts := []claimedFixedPort{}
	claimedHosts := []string{}
	activeRoutes := []activeRoute{}
	serviceExits := make(chan serviceExitResult, 1)
	signalExits := make(chan os.Signal, 1)
	documentInjectionServers := map[string]*devtools.DocumentInjectionServer{}
	var devtoolsControlServer *devtools.ControlServer
	var cleanupError error

	dirtyTracker := NewDirtyTracker()
	onDirty := func(serviceName string) {
		if devtoolsControlServer != nil {
			_ = devtoolsControlServer.PublishHealthResponse()
		}
	}
	watchManager := NewWatchManager(dirtyTracker, onDirty, options.LogWriter, manifest.Name)

	for _, s := range manifest.Services {
		if len(s.Watch) > 0 {
			if err := watchManager.StartWatching(s.Name, s.Watch, s.Cwd); err != nil {
				return 0, fmt.Errorf("failed to start watching for service %s: %w", s.Name, err)
			}
		}
	}

	managedCaddyAdminAddress := caddy.ResolveManagedCaddyAdminAddress(manifest.Caddy.Global.AdminAddress)
	registerProcessSignals(signalExits)
	defer unregisterProcessSignals(signalExits)

	defer func() {
		if watchManager != nil {
			watchManager.StopAll()
		}

		startedServicesMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, startedServices...)
		startedServicesMu.Unlock()
		startedDaemonServicesMu.Lock()
		startedDaemonServicesSnapshot := append([]daemonLifecycleService{}, startedDaemonServices...)
		startedDaemonServicesMu.Unlock()
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

		for _, host := range claimedHosts {
			cleanupError = appendCleanupError(cleanupError, caddy.ReleaseHostClaim(caddy.ClaimHostOptions{
				Host:                       host,
				ManifestPath:               manifest.ManifestPath,
				RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
			}))
		}

		for _, route := range activeRoutes {
			cleanupError = appendCleanupError(cleanupError, caddy.UnregisterRoute(route.serviceName, route.host, route.path, manifest.ManifestPath, paths.RegistrationsDirectoryPath, options.CaddyOutputWriters))
		}

		for _, host := range claimedHosts {
			cleanupError = appendCleanupError(cleanupError, caddy.SyncManagedHostRoute(host, managedCaddyAdminAddress, paths.RoutesDirectoryPath, options.CaddyOutputWriters))
		}

		for _, claim := range claimedFixedPorts {
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

	fallback := caddy.ManagedCaddyConfigFallback{
		AdminAddress: manifest.Caddy.Global.AdminAddress,
		BindHost:     manifest.Caddy.Global.BindHost,
		HTTPEnabled:  manifest.Caddy.Global.HTTP,
		HTTPPort:     manifest.Caddy.Global.HTTPPort,
		HTTPSPort:    manifest.Caddy.Global.HTTPSPort,
		RuntimeOS:    runtime.GOOS,
	}

	if error := caddy.EnsureManagedCaddyConfig(paths, fallback); error != nil {
		return 0, joinCleanupError(error, cleanupError)
	}

	if error := caddy.CleanupStaleRegistrations(paths.RegistrationsDirectoryPath); error != nil {
		return 0, joinCleanupError(error, cleanupError)
	}

	if error := caddy.CleanupStaleFixedPortClaims(paths.PortClaimsDirectoryPath); error != nil {
		return 0, joinCleanupError(error, cleanupError)
	}

	if error := caddy.EnsureManagedCaddyAdminAvailable(caddy.CreateCaddyAdminAPIURL(managedCaddyAdminAddress), caddy.AdminAvailabilityDependencies{}); error != nil {
		return 0, joinCleanupError(error, cleanupError)
	}

	for _, service := range manifest.Services {
		if service.PortSource != "fixed" || service.Port == nil {
			continue
		}

		if error := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{
			BindHost:                service.BindHost,
			ManifestPath:            manifest.ManifestPath,
			Port:                    *service.Port,
			PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
		}); error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		claimedFixedPorts = append(claimedFixedPorts, claimedFixedPort{bindHost: service.BindHost, port: *service.Port})
	}

	for _, host := range collectClaimedHosts(manifest.Services) {
		if error := caddy.ClaimHost(caddy.ClaimHostOptions{
			Host:                       host,
			ManifestPath:               manifest.ManifestPath,
			RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
		}); error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		claimedHosts = append(claimedHosts, host)
	}

	routedServices := collectRoutedServiceIdentities(manifest.Services)
	if devtoolsEnabled && len(routedServices) > 0 {
		devAssetsDir := environment["DEVHOST_DEV_ASSETS_DIR"]
		if devAssetsDir == "" {
			devAssetsDir = os.Getenv("DEVHOST_DEV_ASSETS_DIR")
		}
		if devAssetsDir != "" && !filepath.IsAbs(devAssetsDir) {
			devAssetsDir = filepath.Join(manifest.ManifestDirectoryPath, devAssetsDir)
		}

		if devAssetsDir != "" {
			writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Using on-demand dynamic devtools assets from: %s", devAssetsDir))
		}

		controlServer, error := startDevtoolsControlServer(devtools.StartControlServerOptions{
			AnnotationActions:         manifest.Annotation.Actions,
			AnnotationDefaultActionID: manifest.Annotation.DefaultActionID,
			ComponentEditor:           manifest.Devtools.Editor.IDE,
			DevAssetsDir:               devAssetsDir,
			FeatureToggles:            runtimeDevtoolsFeatures,
			GetHealthResponse: func() (devtools.HealthResponse, error) {
				startedServicesMu.Lock()
				startedServicesSnapshot := append([]*startedService{}, startedServices...)
				startedServicesMu.Unlock()
				return collectServicesHealth(*manifest, startedServicesSnapshot, dirtyTracker), nil
			},
			ManifestPath:    manifest.ManifestPath,
			Position:        manifest.Devtools.Status.Position,
			ProjectRootPath: manifest.ManifestDirectoryPath,
			PrimaryService:  manifest.PrimaryService,
			RestartService: func(serviceNames []string) error {
				// Sort requested list based on their positions in serviceOrder
				orderMap := make(map[string]int)
				for i, name := range serviceOrder {
					orderMap[name] = i
				}
				sort.Slice(serviceNames, func(i, j int) bool {
					return orderMap[serviceNames[i]] < orderMap[serviceNames[j]]
				})

				for _, serviceName := range serviceNames {
					service, ok := manifest.Services[serviceName]
					if !ok {
						return fmt.Errorf("unknown service: %s", serviceName)
					}
					if !isManagedService(service) {
						return fmt.Errorf("service %s is unmanaged and cannot be restarted by devhost", serviceName)
					}

					writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("restarting service: %s", serviceName))

					// Immediately reset dirty status and cancel timers
					dirtyTracker.SetDirty(serviceName, false)
					if watchManager != nil {
						watchManager.CancelTimer(serviceName)
					}

					if usesDaemonLifecycle(service) {
						if devtoolsControlServer != nil {
							_ = devtoolsControlServer.PublishHealthResponse()
						}

						startedDaemonServicesMu.Lock()
						hadStartedDaemon := hasStartedDaemonLifecycleService(startedDaemonServices, serviceName)
						startedDaemonServicesMu.Unlock()
						if hadStartedDaemon {
							if error := stopDaemonLifecycleService(*manifest, service, options, environment, devtoolsControlServer); error != nil {
								return error
							}
						}

						if error := startDaemonLifecycleService(manifest, serviceName, options, environment, devtoolsControlServer); error != nil {
							return error
						}

						startedDaemonServicesMu.Lock()
						startedDaemonServices = upsertStartedDaemonLifecycleService(startedDaemonServices, manifest.Services[serviceName])
						startedDaemonServicesMu.Unlock()
					} else {
						startedServicesMu.Lock()
						targetStartedService := findStartedService(startedServices, serviceName)
						if targetStartedService != nil {
							targetStartedService.setRestarting(true)
						}
						startedServicesMu.Unlock()

						if devtoolsControlServer != nil {
							_ = devtoolsControlServer.PublishHealthResponse()
						}

						if targetStartedService != nil {
							if error := stopStartedService(targetStartedService, gracePeriod); error != nil {
								return error
							}
							startedServicesMu.Lock()
							startedServices = removeStartedService(startedServices, targetStartedService)
							startedServicesMu.Unlock()
						}

						restartedService, restartError := startServiceWithRetries(manifest, serviceName, serviceExits, options, environment, devtoolsControlServer)
						if restartError != nil {
							return restartError
						}

						startedServicesMu.Lock()
						startedServices = append(startedServices, restartedService)
						startedServicesMu.Unlock()
					}

					// Wait for health check to pass successfully before continuing to next service
					if service.Health.Kind != "" {
						retries := service.Health.Retries
						intervalMs := service.Health.Interval * 1000

						healthy := false
						for r := 0; r <= retries; r++ {
							if CheckServiceHealth(service.Health) {
								healthy = true
								break
							}
							time.Sleep(time.Duration(intervalMs) * time.Millisecond)
						}
						if !healthy {
							return fmt.Errorf("service %s did not become healthy within the timeout", serviceName)
						}
					}
				}
				return nil
			},
			RestartServicesShortcut: manifest.Devtools.Shortcuts.RestartServices,
			RoutedServices:          routedServices,
			StateDirectoryPath:      paths.StateDirectoryPath,
			StackName:               manifest.Name,
		})
		if error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		devtoolsControlServer = controlServer
	}

	for _, serviceName := range serviceOrder {
		service, ok := manifest.Services[serviceName]
		if !ok {
			return 0, joinCleanupError(fmt.Errorf("unknown service: %s", serviceName), cleanupError)
		}

		if isManagedService(service) {
			if usesDaemonLifecycle(service) {
				if err := startDaemonLifecycleService(manifest, serviceName, options, environment, devtoolsControlServer); err != nil {
					return 0, joinCleanupError(err, cleanupError)
				}

				startedDaemonServicesMu.Lock()
				startedDaemonServices = append(startedDaemonServices, daemonLifecycleService{service: manifest.Services[serviceName]})
				startedDaemonServicesMu.Unlock()

				service = manifest.Services[serviceName]
			} else {
			started, err := startServiceWithRetries(manifest, serviceName, serviceExits, options, environment, devtoolsControlServer)
			if err != nil {
				return 0, joinCleanupError(err, cleanupError)
			}

			startedServicesMu.Lock()
			startedServices = append(startedServices, started)
			startedServicesMu.Unlock()

			service = started.service
			}
		}

		if service.Host == nil || service.Port == nil {
			continue
		}

		if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.Global.HTTPSPort); warning != "" {
			writeLogLine(options.LogWriter, manifest.Name, warning)
		}

		path := "/"
		if service.Path != nil {
			path = *service.Path
		}

		activateRouteOptions := caddy.ActivateRouteOptions{
			AppBindHost:        service.BindHost,
			AppPort:            *service.Port,
			CaddyAdminAddress:  managedCaddyAdminAddress,
			CaddyBindHost:      manifest.Caddy.Global.BindHost,
			CaddyOutputWriters: options.CaddyOutputWriters,
			CaddyHTTPPort:      manifest.Caddy.Global.HTTPPort,
			CaddyHTTPSPort:     manifest.Caddy.Global.HTTPSPort,
			Host:               *service.Host,
			HTTPEnabled:        manifest.Caddy.Global.HTTP,
			Path:               path,
			ServiceName:        service.Name,
			StackName:          manifest.Name,
		}

		if devtoolsControlServer != nil && isRootCompatibleServicePath(service.Path) {
			proxyHost, error := caddy.ResolveProxyHost(service.BindHost)
			if error != nil {
				return 0, joinCleanupError(error, cleanupError)
			}

			documentInjectionServer, error := startDocumentInjectionServer(devtools.StartDocumentInjectionServerOptions{
				BackendHost: proxyHost,
				BackendPort: *service.Port,
			})
			if error != nil {
				return 0, joinCleanupError(error, cleanupError)
			}

			documentInjectionServers[service.Name] = documentInjectionServer
			activateRouteOptions.DevtoolsControlPort = devtoolsControlServer.Port()
			activateRouteOptions.DocumentInjectionPort = documentInjectionServer.Port()
		}

		if error := caddy.ActivateRoute(activateRouteOptions, manifest.ManifestPath, paths.RoutesDirectoryPath); error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		activeRoutes = append(activeRoutes, activeRoute{host: *service.Host, path: path, serviceName: service.Name})
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
				if statInterval < 10 * time.Millisecond {
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
				if checkInterval < 10 * time.Millisecond {
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

	select {
	case result := <-serviceExits:
		return result.exitCode, nil
	case receivedSignal := <-signalExits:
		startedServicesMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, startedServices...)
		startedServicesMu.Unlock()
		forwardStartedServicesSignal(startedServicesSnapshot, receivedSignal)
		return readSignalExitCode(receivedSignal), nil
	case <-idleShutdownChan:
		writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("Idle timeout of %s reached. Automatically shutting down the stack...", finalIdleTimeout))
		startedServicesMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, startedServices...)
		startedServicesMu.Unlock()
		forwardStartedServicesSignal(startedServicesSnapshot, syscall.SIGTERM)
		return 0, nil
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

	if service.Host != nil {
		environment["DEVHOST_HOST"] = *service.Host
	}

	if service.Path != nil {
		environment["DEVHOST_PATH"] = *service.Path
	}

	return environment
}

func LogServiceURLs(manifest ResolvedManifest, writer io.Writer) {
	for _, serviceName := range orderedManifestServiceNames(manifest) {
		service, ok := manifest.Services[serviceName]
		if !ok {
			continue
		}

		serviceURL := readServiceURL(service, manifest.Caddy.Global.HTTPSPort)
		if serviceURL == nil {
			continue
		}

		displayName := service.Name
		if service.Name == manifest.PrimaryService {
			displayName = fmt.Sprintf("%s (primary)", service.Name)
		}
		writeLogLine(writer, manifest.Name, fmt.Sprintf("%s: %s", displayName, *serviceURL))
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

func readServiceURL(service ResolvedService, httpsPort int) *string {
	if url := readManagedServiceURL(service, httpsPort); url != nil {
		return url
	}

	if service.Port == nil {
		return nil
	}

	proxyHost, error := caddy.ResolveProxyHost(service.BindHost)
	if error != nil {
		return nil
	}

	url := fmt.Sprintf("http://%s", caddy.FormatProxyAddress(proxyHost, *service.Port))
	return &url
}

func startServiceWithRetries(
	manifest *ResolvedManifest,
	serviceName string,
	serviceExits chan<- serviceExitResult,
	options StartStackOptions,
	environment map[string]string,
	devtoolsControlServer *devtools.ControlServer,
) (*startedService, error) {
	service, ok := manifest.Services[serviceName]
	if !ok {
		return nil, fmt.Errorf("unknown service: %s", serviceName)
	}
	if usesDaemonLifecycle(service) {
		return nil, fmt.Errorf("service %s uses daemon lifecycle and must not start as a foreground process", serviceName)
	}

	retryCount := 0

	for {
		service, ok := manifest.Services[serviceName]
		if !ok {
			return nil, fmt.Errorf("unknown service: %s", serviceName)
		}

		attemptOutputLines := []string{}
		started, err := startServiceProcess(*manifest, service, processStartOptions{
			attemptOutputLines: &attemptOutputLines,
			environment:        environment,
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

		err = WaitForServiceHealth(WaitForServiceHealthOptions{
			Health:       service.Health,
			ReadExitCode: started.ReadExitCode,
			ServiceName:  service.Name,
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

		if stopError := stopStartedService(started, resolveGracePeriod(options.ShutdownGracePeriod)); stopError != nil {
			return nil, joinCleanupError(err, stopError)
		}
		if devtoolsControlServer != nil {
			_ = devtoolsControlServer.PublishHealthResponse()
		}

		if !ShouldRetryAutoPortStartup(service, err, attemptOutputLines, retryCount) {
			return nil, err
		}

		retryCount += 1
		writeLogLine(options.LogWriter, manifest.Name, fmt.Sprintf("retrying %s with a new auto port after a bind collision.", service.Name))

		_, nextManifest, retryError := ReassignAutoPort(*manifest, serviceName)
		if retryError != nil {
			return nil, retryError
		}

		*manifest = nextManifest
	}
}

func startDaemonLifecycleService(
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

	running, err := readDaemonLifecycleStatus(*manifest, service, environment, options, devtoolsControlServer)
	if err != nil {
		return err
	}
	if !running {
		if err := runServiceCommand(*manifest, service, service.Lifecycle.Start, "daemon start", environment, options, devtoolsControlServer); err != nil {
			return err
		}
	}

	err = WaitForServiceHealth(WaitForServiceHealthOptions{Health: service.Health, ServiceName: service.Name})
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

	running, err := readDaemonLifecycleStatus(manifest, service, environment, options, devtoolsControlServer)
	if err != nil {
		return err
	}
	if !running {
		return nil
	}

	if err := runServiceCommand(manifest, service, service.Lifecycle.Stop, "daemon stop", environment, options, devtoolsControlServer); err != nil {
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
	manifest ResolvedManifest,
	service ResolvedService,
	environment map[string]string,
	options StartStackOptions,
	devtoolsControlServer *devtools.ControlServer,
) (bool, error) {
	if len(service.Lifecycle.Status) == 0 {
		return false, nil
	}

	err := runServiceCommand(manifest, service, service.Lifecycle.Status, "daemon status", environment, options, devtoolsControlServer)
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

	command := exec.Command(commandArgs[0], commandArgs[1:]...)
	command.Dir = service.Cwd
	command.Env = createChildEnvironment(environment, service.Env, CreateInjectedServiceEnvironment(manifest, service))
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdoutPipe, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("create stdout pipe for service %s %s command: %w", service.Name, commandLabel, err)
	}

	stderrPipe, err := command.StderrPipe()
	if err != nil {
		return fmt.Errorf("create stderr pipe for service %s %s command: %w", service.Name, commandLabel, err)
	}

	if err := command.Start(); err != nil {
		return fmt.Errorf("start service %s %s command: %w", service.Name, commandLabel, err)
	}

	var outputWG sync.WaitGroup
	outputWG.Add(2)
	go pipeProcessOutput(stdoutPipe, fmt.Sprintf("[%s] ", service.Name), resolveStdoutWriter(options.ServiceStdoutWriter), nil, func(line string) {
		if devtoolsControlServer != nil {
			devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStdout, line)
		}
	}, &outputWG)
	go pipeProcessOutput(stderrPipe, fmt.Sprintf("[%s] ", service.Name), resolveStderrWriter(options.ServiceStderrWriter), nil, func(line string) {
		if devtoolsControlServer != nil {
			devtoolsControlServer.PublishLogEntry(service.Name, devtools.ServiceLogStreamStderr, line)
		}
	}, &outputWG)

	err = command.Wait()
	outputWG.Wait()
	if err != nil {
		return fmt.Errorf("wait for service %s %s command: %w", service.Name, commandLabel, err)
	}

	return nil
}

func startServiceProcess(manifest ResolvedManifest, service ResolvedService, options processStartOptions) (*startedService, error) {
	if len(service.Command) == 0 {
		return nil, fmt.Errorf("service %s command is empty", service.Name)
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

	stdoutPipe, error := command.StdoutPipe()
	if error != nil {
		return nil, fmt.Errorf("create stdout pipe for service %s: %w", service.Name, error)
	}

	stderrPipe, error := command.StderrPipe()
	if error != nil {
		return nil, fmt.Errorf("create stderr pipe for service %s: %w", service.Name, error)
	}

	if error := prepareServiceContainment(); error != nil {
		return nil, fmt.Errorf("prepare service %s containment: %w", service.Name, error)
	}

	if error := command.Start(); error != nil {
		return nil, fmt.Errorf("start service %s: %w", service.Name, error)
	}

	containment, error := startServiceContainment(command.Process.Pid, serviceContainmentToken)
	if error != nil {
		serviceSignalSender(command, syscall.Signal(9))
		_ = command.Wait()
		return nil, fmt.Errorf("start service %s containment: %w", service.Name, error)
	}

	startedService := &startedService{
		cmd:         command,
		containment: containment,
		service:     service,
		exited:      make(chan struct{}),
	}

	startedService.outputWG.Add(2)
	go pipeProcessOutput(stdoutPipe, fmt.Sprintf("[%s] ", service.Name), resolveStdoutWriter(options.stdoutWriter), options.attemptOutputLines, options.onStdoutLine, &startedService.outputWG)
	go pipeProcessOutput(stderrPipe, fmt.Sprintf("[%s] ", service.Name), resolveStderrWriter(options.stderrWriter), options.attemptOutputLines, options.onStderrLine, &startedService.outputWG)
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

func pipeProcessOutput(reader io.Reader, prefix string, writer io.Writer, attemptOutputLines *[]string, onLine func(string), wg *sync.WaitGroup) {
	defer wg.Done()

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := prefix + scanner.Text()
		appendAttemptOutputLine(attemptOutputLines, line)
		_, _ = fmt.Fprintln(writer, line)
		if onLine != nil {
			onLine(line)
		}
	}

	if error := scanner.Err(); error != nil {
		appendAttemptOutputLine(attemptOutputLines, prefix+error.Error())
	}
}

func appendAttemptOutputLine(outputLines *[]string, line string) {
	if outputLines == nil {
		return
	}

	*outputLines = append(*outputLines, line)
	if len(*outputLines) > maxAttemptOutputLines {
		*outputLines = (*outputLines)[len(*outputLines)-maxAttemptOutputLines:]
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
		if service.Host == nil {
			continue
		}

		if _, ok := hostsByName[*service.Host]; ok {
			continue
		}

		hostsByName[*service.Host] = struct{}{}
		hosts = append(hosts, *service.Host)
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
		if service.Host == nil {
			continue
		}

		path := "/"
		if service.Path != nil {
			path = *service.Path
		}

		routedServices = append(routedServices, devtools.RoutedServiceIdentity{
			Host:        *service.Host,
			Path:        path,
			ServiceName: service.Name,
		})
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
		if startedService != nil {
			restarting = startedService.isRestartingValue()
		}

		services = append(services, devtools.ServiceHealth{
			Managed:    managed,
			Name:       service.Name,
			Status:     status,
			URL:        readManagedServiceURL(service, manifest.Caddy.Global.HTTPSPort),
			Dirty:      dirty,
			Restarting: restarting,
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
	if service.Host == nil || service.Path == nil {
		return nil
	}

	normalizedPath := normalizeManagedServiceURLPath(*service.Path)
	if normalizedPath == "/" {
		url := caddy.FormatManagedCaddySiteAddress("https", httpsPort, *service.Host)
		return &url
	}

	url := caddy.CreateManagedCaddyURL("https", *service.Host, httpsPort, normalizedPath)
	return &url
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
		if error := syscall.Kill(-command.Process.Pid, signalValue); error == nil {
			return
		}
	}

	_ = command.Process.Signal(signal)
}

func (s *startedService) waitForExit() {
	error := s.cmd.Wait()
	exitCode := -1
	if s.cmd.ProcessState != nil {
		exitCode = s.cmd.ProcessState.ExitCode()
	}
	if error != nil && s.cmd.ProcessState == nil {
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
		listenerPIDs := readListeningProcessIDs(s.service.BindHost, *s.service.Port)
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
	port := *s.service.Port
	s.shutdownMu.Unlock()

	listenerPIDs := readListeningProcessIDs(s.service.BindHost, port)
	if len(listenerPIDs) == 0 {
		return
	}

	for _, pid := range listenerPIDs {
		if pid == os.Getpid() {
			continue
		}
		if error := syscall.Kill(pid, signalValue); error != nil && error != syscall.ESRCH {
			continue
		}
	}
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
	s.isRestarting = value
}

func (s *startedService) isRestartingValue() bool {
	s.restartMu.Lock()
	defer s.restartMu.Unlock()
	return s.isRestarting
}
