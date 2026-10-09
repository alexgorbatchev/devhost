package services

import (
	"fmt"
	"net"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	defaultHealthInterval = 200
	defaultHealthRetries  = 0
	defaultHealthTimeout  = 30000
)

// HealthKind enumerates the supported service health-probe strategies.
// Any value outside this set is treated as unhealthy by checkServiceHealth.
const (
	HealthKindProcess = "process"
	HealthKindTCP     = "tcp"
	HealthKindHTTP    = "http"
)

type ResolvedManifest struct {
	// Retain unresolved templates so automatic-port retries can bind them again.
	configuration *manifest.Manifest
	// requested holds the service names given to devhost start and those started
	// since; empty means every service runs.
	requested             []string
	Annotation            manifest.ValidatedAnnotation
	Caddy                 manifest.CaddyConfig
	Devtools              manifest.DevtoolsConfig
	Worktrees             manifest.WorktreesConfig
	ManifestDirectoryPath string
	ManifestPath          string
	Name                  string
	PrimaryService        string
	ServiceOrder          []string
	Services              map[string]ResolvedService
	// Stopped holds the services this run leaves out. They keep resolved addresses so
	// templates and injected ports that name them stay the same once they start.
	Stopped     map[string]ResolvedService
	KillZombies bool
}

type ResolvedService struct {
	ProxyLocalOrigin bool
	BindHost         string
	Command          []string
	Cwd              string
	DependsOn        []string
	Env              map[string]string
	Health           ResolvedHealthConfig
	Hosts            []string
	InjectPort       bool
	Lifecycle        ResolvedServiceLifecycle
	Managed          bool
	Name             string
	Path             *string
	Port             *int
	PortSource       string
	Watch            []string
}

type ResolvedServiceLifecycle struct {
	Mode   string
	Start  []string
	Status []string
	Stop   []string
}

type ResolvedHealthConfig struct {
	Host     *string
	Interval int
	Kind     string
	Port     *int
	Retries  int
	Timeout  int
	URL      *string
}

func ResolveServicePorts(value manifest.Manifest) (ResolvedManifest, error) {
	return resolveServicePorts(value, portResolutionOptions{})
}

// ResolveRequestedServicePorts resolves the manifest for a run that names the
// services to start. With no names every service starts.
func ResolveRequestedServicePorts(value manifest.Manifest, requested []string) (ResolvedManifest, error) {
	return resolveServicePorts(value, portResolutionOptions{Requested: requested})
}

type portResolutionOptions struct {
	Requested []string
	Preserved map[string]int
	Excluded  map[string]map[int]struct{}
}

func resolveServicePorts(value manifest.Manifest, options portResolutionOptions) (ResolvedManifest, error) {
	preserved := options.Preserved
	excludedPortsByHost := collectFixedPorts(value.Services)
	for host, ports := range options.Excluded {
		if excludedPortsByHost[host] == nil {
			excludedPortsByHost[host] = map[int]struct{}{}
		}
		for port := range ports {
			excludedPortsByHost[host][port] = struct{}{}
		}
	}
	for name, port := range preserved {
		host := value.Services[name].BindHost
		if excludedPortsByHost[host] == nil {
			excludedPortsByHost[host] = map[int]struct{}{}
		}
		excludedPortsByHost[host][port] = struct{}{}
	}
	resolvedServices := map[string]ResolvedService{}

	for serviceName, service := range value.Services {
		excludedPorts := excludedPortsByHost[service.BindHost]
		if excludedPorts == nil {
			excludedPorts = map[int]struct{}{}
		}

		var resolvedPort *int
		portSource := "none"
		if service.Port != nil {
			if service.Port.Auto {
				port, ok := preserved[serviceName]
				if !ok {
					var err error
					port, err = reserveAutoPort(service.BindHost, excludedPorts)
					if err != nil {
						return ResolvedManifest{}, err
					}
				}
				resolvedPort = &port
				excludedPorts[port] = struct{}{}
				excludedPortsByHost[service.BindHost] = excludedPorts
				portSource = "auto"
			} else {
				port := service.Port.Number
				resolvedPort = &port
				portSource = "fixed"
			}
		}

		health, err := resolveHealthConfig(service, resolvedPort)
		if err != nil {
			return ResolvedManifest{}, err
		}

		if resolvedPort != nil && hasRuntimeBindPortConflict(service.BindHost, *resolvedPort, resolvedServices) {
			return ResolvedManifest{}, fmt.Errorf("Resolved runtime bind port is duplicated: %s:%d", service.BindHost, *resolvedPort)
		}

		resolvedServices[serviceName] = ResolvedService{
			ProxyLocalOrigin: service.ProxyLocalOrigin,
			BindHost:         service.BindHost,
			Command:          service.Command,
			Cwd:              service.Cwd,
			DependsOn:        service.DependsOn,
			Env:              service.Env,
			Health:           health,
			Hosts:            append([]string{}, service.Hosts...),
			InjectPort:       service.InjectPort,
			Lifecycle: ResolvedServiceLifecycle{
				Mode:   service.Lifecycle.Mode,
				Start:  append([]string{}, service.Lifecycle.Start...),
				Status: append([]string{}, service.Lifecycle.Status...),
				Stop:   append([]string{}, service.Lifecycle.Stop...),
			},
			Managed:    isValidatedServiceManaged(service),
			Name:       service.Name,
			Path:       service.Path,
			Port:       resolvedPort,
			PortSource: portSource,
			Watch:      service.Watch,
		}
	}

	for serviceName, service := range resolvedServices {
		interpolatedEnv := make(map[string]string, len(service.Env))
		for k, v := range service.Env {
			val, err := interpolateServiceTemplates(v, resolvedServices)
			if err != nil {
				return ResolvedManifest{}, fmt.Errorf("service %q: interpolate env %q: %w", serviceName, k, err)
			}
			interpolatedEnv[k] = val
		}
		service.Env = interpolatedEnv

		interpolatedCommand := make([]string, len(service.Command))
		for i, cmdPart := range service.Command {
			val, err := interpolateServiceTemplates(cmdPart, resolvedServices)
			if err != nil {
				return ResolvedManifest{}, fmt.Errorf("service %q: interpolate command arg %q: %w", serviceName, cmdPart, err)
			}
			interpolatedCommand[i] = val
		}
		service.Command = interpolatedCommand

		resolvedServices[serviceName] = service
	}

	started := startedServiceNames(value, options.Requested)
	stoppedServices := map[string]ResolvedService{}
	for serviceName, service := range resolvedServices {
		if !started[serviceName] {
			stoppedServices[serviceName] = service
			delete(resolvedServices, serviceName)
		}
	}

	return ResolvedManifest{
		configuration:         &value,
		requested:             slices.Clone(options.Requested),
		Annotation:            value.Annotation,
		Caddy:                 value.Caddy,
		Devtools:              value.Devtools,
		Worktrees:             value.Worktrees,
		ManifestDirectoryPath: value.ManifestDirectoryPath,
		ManifestPath:          value.ManifestPath,
		Name:                  value.Name,
		PrimaryService:        value.PrimaryService,
		ServiceOrder:          append([]string{}, value.ServiceOrder...),
		Services:              resolvedServices,
		Stopped:               stoppedServices,
		KillZombies:           value.KillZombies,
	}, nil
}

func interpolateServiceTemplates(val string, resolvedServices map[string]ResolvedService) (string, error) {
	var builder strings.Builder
	builder.Grow(len(val))

	for i := 0; i < len(val); {
		if val[i] != '{' || i+1 >= len(val) || val[i+1] != '{' {
			builder.WriteByte(val[i])
			i++
			continue
		}

		closeIdx := strings.Index(val[i+2:], "}}")
		if closeIdx < 0 {
			builder.WriteString(val[i:])
			break
		}
		closeIdx += i + 2

		rawExpr := val[i+2 : closeIdx]
		trimmedExpr := strings.TrimSpace(rawExpr)

		if strings.HasPrefix(trimmedExpr, "services.") {
			parts := strings.Split(trimmedExpr, ".")
			if len(parts) == 3 {
				targetServiceName := parts[1]
				property := parts[2]

				targetService, ok := resolvedServices[targetServiceName]
				if !ok {
					return "", fmt.Errorf("referenced service %q in template %q does not exist", targetServiceName, val[i:closeIdx+2])
				}

				var resolvedValue string
				switch property {
				case "port":
					if targetService.Port == nil {
						return "", fmt.Errorf("referenced service %q in template %q does not have a port", targetServiceName, val[i:closeIdx+2])
					}
					resolvedValue = fmt.Sprintf("%d", *targetService.Port)
				case "host":
					if len(targetService.Hosts) > 0 {
						resolvedValue = targetService.Hosts[0]
					} else {
						resolvedValue = targetService.BindHost
					}
				case "bindHost":
					resolvedValue = targetService.BindHost
				default:
					return "", fmt.Errorf("unknown property %q on service %q in template %q", property, targetServiceName, val[i:closeIdx+2])
				}

				builder.WriteString(resolvedValue)
				i = closeIdx + 2
				continue
			} else {
				return "", fmt.Errorf("invalid template expression %q (expected services.<name>.<property>)", val[i:closeIdx+2])
			}
		}

		builder.WriteString(val[i : closeIdx+2])
		i = closeIdx + 2
	}

	return builder.String(), nil
}

func isValidatedServiceManaged(service manifest.ValidatedService) bool {
	return service.Managed || len(service.Command) > 0 || service.Lifecycle.Mode == "daemon"
}

func collectFixedPorts(services map[string]manifest.ValidatedService) map[string]map[int]struct{} {
	excludedPortsByHost := map[string]map[int]struct{}{}
	for _, service := range services {
		if service.Port == nil || service.Port.Auto {
			continue
		}

		excludedPorts := excludedPortsByHost[service.BindHost]
		if excludedPorts == nil {
			excludedPorts = map[int]struct{}{}
		}
		excludedPorts[service.Port.Number] = struct{}{}
		excludedPortsByHost[service.BindHost] = excludedPorts
	}
	return excludedPortsByHost
}

func reserveAutoPort(bindHost string, excludedPorts map[int]struct{}) (int, error) {
	listener, err := net.Listen("tcp", net.JoinHostPort(bindHost, "0"))
	if err != nil {
		return 0, fmt.Errorf("reserve auto port for %s: %w", bindHost, err)
	}
	defer listener.Close()

	resolvedPort := listener.Addr().(*net.TCPAddr).Port
	if _, ok := excludedPorts[resolvedPort]; ok {
		return reserveAutoPort(bindHost, excludedPorts)
	}

	return resolvedPort, nil
}

func resolveHealthConfig(service manifest.ValidatedService, resolvedPort *int) (ResolvedHealthConfig, error) {
	baseHealth := ResolvedHealthConfig{Interval: defaultHealthInterval, Retries: defaultHealthRetries, Timeout: defaultHealthTimeout}
	if service.Health != nil {
		if service.Health.TCP != nil {
			host := service.BindHost
			port := *service.Health.TCP
			return ResolvedHealthConfig{Host: &host, Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: HealthKindTCP, Port: &port, Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout)}, nil
		}

		if service.Health.HTTP != nil {
			url := *service.Health.HTTP
			return ResolvedHealthConfig{Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: HealthKindHTTP, Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout), URL: &url}, nil
		}

		return ResolvedHealthConfig{Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: HealthKindProcess, Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout)}, nil
	}

	if resolvedPort == nil {
		return ResolvedHealthConfig{}, fmt.Errorf("Service %s is missing an effective health check.", service.Name)
	}

	host := service.BindHost
	return ResolvedHealthConfig{Host: &host, Interval: baseHealth.Interval, Kind: HealthKindTCP, Port: resolvedPort, Retries: baseHealth.Retries, Timeout: baseHealth.Timeout}, nil
}

func hasRuntimeBindPortConflict(bindHost string, port int, resolvedServices map[string]ResolvedService) bool {
	for _, service := range resolvedServices {
		if service.Port == nil {
			continue
		}

		if service.BindHost == bindHost && *service.Port == port {
			return true
		}
	}
	return false
}

func valueOrDefault(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}
