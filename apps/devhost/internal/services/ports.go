package services

import (
	"fmt"
	"net"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	defaultHealthInterval = 200
	defaultHealthRetries  = 0
	defaultHealthTimeout  = 30000
)

type ResolvedManifest struct {
	Annotation            manifest.ValidatedAnnotation
	Caddy                 manifest.CaddyConfig
	Devtools              manifest.DevtoolsConfig
	ManifestDirectoryPath string
	ManifestPath          string
	Name                  string
	PrimaryService        string
	ServiceOrder          []string
	Services              map[string]ResolvedService
}

type ResolvedService struct {
	BindHost   string
	Command    []string
	Cwd        string
	DependsOn  []string
	Env        map[string]string
	Health     ResolvedHealthConfig
	Host       *string
	InjectPort bool
	Lifecycle  ResolvedServiceLifecycle
	Managed    bool
	Name       string
	Path       *string
	Port       *int
	PortSource string
	Watch      []string
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
	excludedPortsByHost := collectFixedPorts(value.Services)
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
				port, error := reserveAutoPort(service.BindHost, excludedPorts)
				if error != nil {
					return ResolvedManifest{}, error
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

		health, error := resolveHealthConfig(service, resolvedPort)
		if error != nil {
			return ResolvedManifest{}, error
		}

		if resolvedPort != nil && hasRuntimeBindPortConflict(service.BindHost, *resolvedPort, resolvedServices) {
			return ResolvedManifest{}, fmt.Errorf("Resolved runtime bind port is duplicated: %s:%d", service.BindHost, *resolvedPort)
		}

		resolvedServices[serviceName] = ResolvedService{
			BindHost:   service.BindHost,
			Command:    service.Command,
			Cwd:        service.Cwd,
			DependsOn:  service.DependsOn,
			Env:        service.Env,
			Health:     health,
			Host:       service.Host,
			InjectPort: service.InjectPort,
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

	return ResolvedManifest{
		Annotation:            value.Annotation,
		Caddy:                 value.Caddy,
		Devtools:              value.Devtools,
		ManifestDirectoryPath: value.ManifestDirectoryPath,
		ManifestPath:          value.ManifestPath,
		Name:                  value.Name,
		PrimaryService:        value.PrimaryService,
		ServiceOrder:          append([]string{}, value.ServiceOrder...),
		Services:              resolvedServices,
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
					if targetService.Host != nil {
						resolvedValue = *targetService.Host
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
	listener, error := net.Listen("tcp", net.JoinHostPort(bindHost, "0"))
	if error != nil {
		return 0, fmt.Errorf("reserve auto port for %s: %w", bindHost, error)
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
			return ResolvedHealthConfig{Host: &host, Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: "tcp", Port: &port, Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout)}, nil
		}

		if service.Health.HTTP != nil {
			url := *service.Health.HTTP
			return ResolvedHealthConfig{Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: "http", Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout), URL: &url}, nil
		}

		return ResolvedHealthConfig{Interval: valueOrDefault(service.Health.Interval, defaultHealthInterval), Kind: "process", Retries: valueOrDefault(service.Health.Retries, defaultHealthRetries), Timeout: valueOrDefault(service.Health.Timeout, defaultHealthTimeout)}, nil
	}

	if resolvedPort == nil {
		return ResolvedHealthConfig{}, fmt.Errorf("Service %s is missing an effective health check.", service.Name)
	}

	host := service.BindHost
	return ResolvedHealthConfig{Host: &host, Interval: baseHealth.Interval, Kind: "tcp", Port: resolvedPort, Retries: baseHealth.Retries, Timeout: baseHealth.Timeout}, nil
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
