package services

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/caddy"
)

const (
	defaultLogLabel        = "devhost"
	maxAttemptOutputLines  = 50
	shutdownGracePeriod    = 10 * time.Second
)

type StartStackOptions struct {
	CaddyPaths         caddy.Paths
	Environment        map[string]string
	LogWriter          io.Writer
	ServiceStdoutWriter io.Writer
	ServiceStderrWriter io.Writer
	ShutdownGracePeriod time.Duration
}

type startedService struct {
	cmd      *exec.Cmd
	service  ResolvedService
	exited   chan struct{}
	outputWG sync.WaitGroup

	exitMu    sync.Mutex
	exitCode  int
	hasExited bool
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
	stderrWriter       io.Writer
	stdoutWriter       io.Writer
}

func StartStack(manifest *ResolvedManifest, serviceOrder []string, options StartStackOptions) (int, error) {
	if manifest == nil {
		return 0, fmt.Errorf("manifest is required")
	}

	if len(serviceOrder) == 0 {
		return 0, fmt.Errorf("service order is required")
	}

	if hasEnabledDevtools(manifest.Devtools) {
		return 0, fmt.Errorf("manifest mode with devtools enabled is not implemented yet in the Go rewrite")
	}

	environment := copyEnvironment(options.Environment)
	if len(environment) == 0 {
		environment = readCurrentEnvironment()
	}

	paths, error := resolveStartStackPaths(options.CaddyPaths, environment)
	if error != nil {
		return 0, error
	}

	gracePeriod := options.ShutdownGracePeriod
	if gracePeriod <= 0 {
		gracePeriod = shutdownGracePeriod
	}

	startedServices := []*startedService{}
	claimedFixedPorts := []claimedFixedPort{}
	claimedHosts := []string{}
	activeRoutes := []activeRoute{}
	serviceExits := make(chan serviceExitResult, len(serviceOrder))
	var cleanupError error

	managedCaddyAdminAddress := caddy.ResolveManagedCaddyAdminAddress(manifest.Caddy.Global.AdminAddress)

	defer func() {
		stopStartedServices(startedServices, gracePeriod)

		for _, route := range activeRoutes {
			if error := caddy.UnregisterRoute(route.serviceName, route.host, route.path, manifest.ManifestPath, paths.RegistrationsDirectoryPath); error != nil && cleanupError == nil {
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

	for _, serviceName := range serviceOrder {
		startedService, error := startServiceWithRetries(manifest, serviceName, serviceExits, options, environment)
		if error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		startedServices = append(startedServices, startedService)

		service := startedService.service
		if service.Host == nil || service.Port == nil {
			continue
		}

		path := "/"
		if service.Path != nil {
			path = *service.Path
		}

		if error := caddy.ActivateRoute(caddy.ActivateRouteOptions{
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
		}, manifest.ManifestPath, paths.RoutesDirectoryPath); error != nil {
			return 0, joinCleanupError(error, cleanupError)
		}

		activeRoutes = append(activeRoutes, activeRoute{host: *service.Host, path: path, serviceName: service.Name})
	}

	LogPrimaryService(*manifest, options.LogWriter)

	result := <-serviceExits
	if cleanupError != nil {
		return 0, joinCleanupError(fmt.Errorf("service %s exited with code %d", result.serviceName, result.exitCode), cleanupError)
	}

	return result.exitCode, nil
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
) (*startedService, error) {
	retryCount := 0

	for {
		service, ok := manifest.Services[serviceName]
		if !ok {
			return nil, fmt.Errorf("unknown service: %s", serviceName)
		}

		attemptOutputLines := []string{}
		startedService, error := startServiceProcess(*manifest, service, processStartOptions{
			attemptOutputLines: &attemptOutputLines,
			environment:        environment,
			stderrWriter:       options.ServiceStderrWriter,
			stdoutWriter:       options.ServiceStdoutWriter,
		})
		if error != nil {
			return nil, error
		}

		error = WaitForServiceHealth(WaitForServiceHealthOptions{
			Health:      service.Health,
			ReadExitCode: startedService.ReadExitCode,
			ServiceName: service.Name,
		})
		if error == nil {
			if warning := ReadLoopbackBindHostAmbiguityWarning(service, manifest.Caddy.Global.HTTPSPort); warning != "" {
				writeLogLine(options.LogWriter, manifest.Name, warning)
			}

			go func(started *startedService) {
				<-started.exited
				serviceExits <- serviceExitResult{exitCode: started.exitCodeValue(), serviceName: started.service.Name}
			}(startedService)

			return startedService, nil
		}

		stopStartedService(startedService, resolveGracePeriod(options.ShutdownGracePeriod))

		if !ShouldRetryAutoPortStartup(service, error, attemptOutputLines, retryCount) {
			return nil, error
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
	go pipeProcessOutput(stdoutPipe, fmt.Sprintf("[%s] ", service.Name), resolveStdoutWriter(options.stdoutWriter), options.attemptOutputLines, &startedService.outputWG)
	go pipeProcessOutput(stderrPipe, fmt.Sprintf("[%s] ", service.Name), resolveStderrWriter(options.stderrWriter), options.attemptOutputLines, &startedService.outputWG)
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

	sendSignal(startedService.cmd, syscall.Signal(15))
	if waitForExitWithinGracePeriod(startedService, gracePeriod) {
		startedService.wait()
		return
	}

	sendSignal(startedService.cmd, syscall.Signal(9))
	startedService.wait()
}

func stopStartedServices(startedServices []*startedService, gracePeriod time.Duration) {
	for index := len(startedServices) - 1; index >= 0; index-- {
		startedService := startedServices[index]
		if startedService == nil || startedService.ReadExitCode() != nil {
			continue
		}

		sendSignal(startedService.cmd, syscall.Signal(15))
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
			sendSignal(startedService.cmd, syscall.Signal(9))
		}

		startedService.wait()
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

func pipeProcessOutput(reader io.Reader, prefix string, writer io.Writer, attemptOutputLines *[]string, wg *sync.WaitGroup) {
	defer wg.Done()

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := prefix + scanner.Text()
		appendAttemptOutputLine(attemptOutputLines, line)
		_, _ = fmt.Fprintln(writer, line)
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

func hasEnabledDevtools(config interface{ Editor struct{ Enabled bool }; ExternalToolbars struct{ Enabled bool }; Minimap struct{ Enabled bool }; Status struct{ Enabled bool } }) bool {
	return config.Editor.Enabled || config.ExternalToolbars.Enabled || config.Minimap.Enabled || config.Status.Enabled
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
