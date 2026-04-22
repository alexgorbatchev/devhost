package services

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	defaultLogLabel       = "devhost"
	maxAttemptOutputLines = 50
	shutdownGracePeriod   = 10 * time.Second
)

var serviceSignalSender = sendSignal
var startDevtoolsControlServer = devtools.StartControlServer
var startDocumentInjectionServer = devtools.StartDocumentInjectionServer
var registerProcessSignals = func(ch chan<- os.Signal) {
	signal.Notify(ch, supportedSignals...)
}
var unregisterProcessSignals = signal.Stop

var supportedSignals = []os.Signal{syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM}

var signalExitCodes = map[syscall.Signal]int{
	syscall.SIGINT:  130,
	syscall.SIGHUP:  129,
	syscall.SIGTERM: 143,
}

type StartStackOptions struct {
	CaddyPaths          caddy.Paths
	Environment         map[string]string
	LogWriter           io.Writer
	ServiceStdoutWriter io.Writer
	ServiceStderrWriter io.Writer
	ShutdownGracePeriod time.Duration
}

type startedService struct {
	cmd      *exec.Cmd
	service  ResolvedService
	exited   chan struct{}
	outputWG sync.WaitGroup

	restartMu    sync.Mutex
	isRestarting bool
	exitMu       sync.Mutex
	exitCode     int
	hasExited    bool
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

	runtimeDevtoolsFeatures := resolveSupportedDevtoolsFeatures(manifest.Devtools)
	devtoolsEnabled := hasEnabledDevtools(manifest.Devtools) && hasEnabledRuntimeDevtools(runtimeDevtoolsFeatures)
	startedServices := []*startedService{}
	var startedServicesMu sync.Mutex
	claimedFixedPorts := []claimedFixedPort{}
	claimedHosts := []string{}
	activeRoutes := []activeRoute{}
	serviceExits := make(chan serviceExitResult, 1)
	signalExits := make(chan os.Signal, 1)
	documentInjectionServers := map[string]*devtools.DocumentInjectionServer{}
	var devtoolsControlServer *devtools.ControlServer
	var cleanupError error

	managedCaddyAdminAddress := caddy.ResolveManagedCaddyAdminAddress(manifest.Caddy.Global.AdminAddress)
	registerProcessSignals(signalExits)
	defer unregisterProcessSignals(signalExits)

	defer func() {
		startedServicesMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, startedServices...)
		startedServicesMu.Unlock()
		stopStartedServices(startedServicesSnapshot, gracePeriod)

		for _, documentInjectionServer := range documentInjectionServers {
			if documentInjectionServer == nil {
				continue
			}
			if error := documentInjectionServer.Stop(); error != nil && cleanupError == nil {
				cleanupError = error
			}
		}

		if devtoolsControlServer != nil {
			if error := devtoolsControlServer.Stop(); error != nil && cleanupError == nil {
				cleanupError = error
			}
		}

		for _, host := range claimedHosts {
			if error := caddy.ReleaseHostClaim(caddy.ClaimHostOptions{
				Host:                       host,
				ManifestPath:               manifest.ManifestPath,
				RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
			}); error != nil && cleanupError == nil {
				cleanupError = error
			}
		}

		for _, route := range activeRoutes {
			if error := caddy.UnregisterRoute(route.serviceName, route.host, route.path, manifest.ManifestPath, paths.RegistrationsDirectoryPath); error != nil && cleanupError == nil {
				cleanupError = error
			}
		}

		for _, host := range claimedHosts {
			if error := caddy.SyncManagedHostRoute(host, managedCaddyAdminAddress, paths.RoutesDirectoryPath); error != nil && cleanupError == nil {
				cleanupError = error
			}
		}

		for _, claim := range claimedFixedPorts {
			if error := caddy.ReleaseFixedPortClaim(caddy.ClaimFixedPortOptions{
				BindHost:                claim.bindHost,
				ManifestPath:            manifest.ManifestPath,
				Port:                    claim.port,
				PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
			}); error != nil && cleanupError == nil {
				cleanupError = error
			}
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
		controlServer, error := startDevtoolsControlServer(devtools.StartControlServerOptions{
			Agent:            manifest.Agent,
			AgentDisplayName: manifest.Agent.DisplayName,
			ComponentEditor:  manifest.Devtools.Editor.IDE,
			FeatureToggles:   runtimeDevtoolsFeatures,
			GetHealthResponse: func() (devtools.HealthResponse, error) {
				startedServicesMu.Lock()
				startedServicesSnapshot := append([]*startedService{}, startedServices...)
				startedServicesMu.Unlock()
				return collectServicesHealth(*manifest, startedServicesSnapshot), nil
			},
			ManifestPath:    manifest.ManifestPath,
			Position:        manifest.Devtools.Status.Position,
			ProjectRootPath: manifest.ManifestDirectoryPath,
			RestartService: func(serviceName string) error {
				service, ok := manifest.Services[serviceName]
				if !ok {
					return fmt.Errorf("unknown service: %s", serviceName)
				}
				if !isManagedService(service) {
					return fmt.Errorf("service %s is unmanaged and cannot be restarted by devhost", serviceName)
				}

				startedServicesMu.Lock()
				targetStartedService := findStartedService(startedServices, serviceName)
				if targetStartedService != nil {
					targetStartedService.setRestarting(true)
				}
				startedServicesMu.Unlock()

				if targetStartedService != nil {
					stopStartedService(targetStartedService, gracePeriod)
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
				return nil
			},
			RoutedServices:     routedServices,
			StateDirectoryPath: paths.StateDirectoryPath,
			StackName:          manifest.Name,
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
			started, err := startServiceWithRetries(manifest, serviceName, serviceExits, options, environment, devtoolsControlServer)
			if err != nil {
				return 0, joinCleanupError(err, cleanupError)
			}

			startedServicesMu.Lock()
			startedServices = append(startedServices, started)
			startedServicesMu.Unlock()

			service = started.service
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
			AppBindHost:       service.BindHost,
			AppPort:           *service.Port,
			CaddyAdminAddress: managedCaddyAdminAddress,
			CaddyBindHost:     manifest.Caddy.Global.BindHost,
			CaddyHTTPPort:     manifest.Caddy.Global.HTTPPort,
			CaddyHTTPSPort:    manifest.Caddy.Global.HTTPSPort,
			Host:              *service.Host,
			HTTPEnabled:       manifest.Caddy.Global.HTTP,
			Path:              path,
			ServiceName:       service.Name,
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

	LogPrimaryService(*manifest, options.LogWriter)

	select {
	case result := <-serviceExits:
		return result.exitCode, nil
	case receivedSignal := <-signalExits:
		startedServicesMu.Lock()
		startedServicesSnapshot := append([]*startedService{}, startedServices...)
		startedServicesMu.Unlock()
		forwardStartedServicesSignal(startedServicesSnapshot, receivedSignal)
		return readSignalExitCode(receivedSignal), nil
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

func LogPrimaryService(manifest ResolvedManifest, writer io.Writer) {
	primaryService, ok := manifest.Services[manifest.PrimaryService]
	if !ok {
		return
	}

	if primaryService.Host != nil {
		writeLogLine(writer, manifest.Name, fmt.Sprintf(
			"primary %s",
			strings.TrimSuffix(caddy.CreateManagedCaddyURL("https", *primaryService.Host, manifest.Caddy.Global.HTTPSPort, "/"), "/"),
		))
		return
	}

	if primaryService.Port == nil {
		return
	}

	proxyHost, error := caddy.ResolveProxyHost(primaryService.BindHost)
	if error != nil {
		return
	}

	writeLogLine(writer, manifest.Name, fmt.Sprintf("primary %s -> http://%s", primaryService.Name, caddy.FormatProxyAddress(proxyHost, *primaryService.Port)))
}

func startServiceWithRetries(
	manifest *ResolvedManifest,
	serviceName string,
	serviceExits chan<- serviceExitResult,
	options StartStackOptions,
	environment map[string]string,
	devtoolsControlServer *devtools.ControlServer,
) (*startedService, error) {
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

		stopStartedService(started, resolveGracePeriod(options.ShutdownGracePeriod))
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

func startServiceProcess(manifest ResolvedManifest, service ResolvedService, options processStartOptions) (*startedService, error) {
	if len(service.Command) == 0 {
		return nil, fmt.Errorf("service %s command is empty", service.Name)
	}

	command := exec.Command(service.Command[0], service.Command[1:]...)
	command.Dir = service.Cwd
	command.Env = createChildEnvironment(options.environment, service.Env, CreateInjectedServiceEnvironment(manifest, service))

	stdoutPipe, error := command.StdoutPipe()
	if error != nil {
		return nil, fmt.Errorf("create stdout pipe for service %s: %w", service.Name, error)
	}

	stderrPipe, error := command.StderrPipe()
	if error != nil {
		return nil, fmt.Errorf("create stderr pipe for service %s: %w", service.Name, error)
	}

	if error := command.Start(); error != nil {
		return nil, fmt.Errorf("start service %s: %w", service.Name, error)
	}

	startedService := &startedService{
		cmd:     command,
		service: service,
		exited:  make(chan struct{}),
	}

	startedService.outputWG.Add(2)
	go pipeProcessOutput(stdoutPipe, fmt.Sprintf("[%s] ", service.Name), resolveStdoutWriter(options.stdoutWriter), options.attemptOutputLines, options.onStdoutLine, &startedService.outputWG)
	go pipeProcessOutput(stderrPipe, fmt.Sprintf("[%s] ", service.Name), resolveStderrWriter(options.stderrWriter), options.attemptOutputLines, options.onStderrLine, &startedService.outputWG)
	go startedService.waitForExit()

	return startedService, nil
}

func stopStartedService(startedService *startedService, gracePeriod time.Duration) {
	if startedService == nil {
		return
	}

	if startedService.ReadExitCode() != nil {
		startedService.wait()
		return
	}

	serviceSignalSender(startedService.cmd, syscall.Signal(15))
	if waitForExitWithinGracePeriod(startedService, gracePeriod) {
		startedService.wait()
		return
	}

	serviceSignalSender(startedService.cmd, syscall.Signal(9))
	startedService.wait()
}

func stopStartedServices(startedServices []*startedService, gracePeriod time.Duration) {
	for index := len(startedServices) - 1; index >= 0; index-- {
		startedService := startedServices[index]
		if startedService == nil || startedService.ReadExitCode() != nil {
			continue
		}

		serviceSignalSender(startedService.cmd, syscall.Signal(15))
	}

	for index := len(startedServices) - 1; index >= 0; index-- {
		startedService := startedServices[index]
		if startedService == nil {
			continue
		}

		if startedService.ReadExitCode() != nil {
			startedService.wait()
			continue
		}

		if !waitForExitWithinGracePeriod(startedService, gracePeriod) {
			serviceSignalSender(startedService.cmd, syscall.Signal(9))
		}

		startedService.wait()
	}
}

func forwardStartedServicesSignal(startedServices []*startedService, receivedSignal os.Signal) {
	for _, startedService := range startedServices {
		if startedService == nil || startedService.ReadExitCode() != nil {
			continue
		}

		serviceSignalSender(startedService.cmd, receivedSignal)
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

func resolveSupportedDevtoolsFeatures(config manifest.DevtoolsConfig) devtools.FeatureToggles {
	devtoolsEnabled := hasEnabledDevtools(config)

	return devtools.FeatureToggles{
		AnnotationEnabled:       devtoolsEnabled,
		AnnotationQueueEnabled:  devtoolsEnabled,
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

func collectServicesHealth(manifest ResolvedManifest, startedServices []*startedService) devtools.HealthResponse {
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
		} else if startedService != nil && startedService.ReadExitCode() == nil {
			status = CheckServiceHealth(service.Health)
		}

		services = append(services, devtools.ServiceHealth{
			Managed: managed,
			Name:   service.Name,
			Status: status,
			URL:    readManagedServiceURL(service, manifest.Caddy.Global.HTTPSPort),
		})
	}

	return devtools.HealthResponse{Services: services}
}

func isManagedService(service ResolvedService) bool {
	return service.Managed || len(service.Command) > 0
}

func readManagedServiceURL(service ResolvedService, httpsPort int) *string {
	if service.Host == nil || service.Path == nil {
		return nil
	}

	url := caddy.CreateManagedCaddyURL("https", *service.Host, httpsPort, normalizeManagedServiceURLPath(*service.Path))
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

	return fmt.Errorf("%w\ncleanup: %s", runError, cleanupError)
}

func sendSignal(command *exec.Cmd, signal os.Signal) {
	if command == nil || command.Process == nil {
		return
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
