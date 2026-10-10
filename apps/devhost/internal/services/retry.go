package services

import (
	"fmt"
	"net"
	"regexp"
	"strings"
)

const MaximumAutoPortRetryCount = 3

var autoPortBindCollisionPattern = regexp.MustCompile(`(?i)EADDRINUSE|address already in use|bind: address already in use`)

func validateAssignedAutoPort(service ResolvedService) error {
	if service.PortSource != "auto" || service.Port == nil {
		return nil
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(service.BindHost, fmt.Sprint(*service.Port)))
	if err != nil {
		return assignedAutoPortConflict(service, err)
	}
	return listener.Close()
}

func assignedAutoPortConflict(service ResolvedService, err error) error {
	return fmt.Errorf("service %s could not bind its assigned port %d; use Restart stack with new ports to recover: %w", service.Name, *service.Port, err)
}

func ShouldRetryAutoPortStartup(service ResolvedService, startupError error, outputLines []string, retryCount int) bool {
	if service.PortSource != "auto" || retryCount >= MaximumAutoPortRetryCount {
		return false
	}

	errorMessage := ""
	if startupError != nil {
		errorMessage = startupError.Error()
	}

	combinedOutput := strings.Join(append([]string{errorMessage}, outputLines...), "\n")
	return autoPortBindCollisionPattern.MatchString(combinedOutput)
}

func ReassignAutoPort(value ResolvedManifest, serviceName string) (ResolvedService, ResolvedManifest, error) {
	service, ok := value.Services[serviceName]
	if !ok {
		return ResolvedService{}, ResolvedManifest{}, fmt.Errorf("Unknown service: %s", serviceName)
	}

	excludedPorts := collectExcludedRuntimePorts(value, service.BindHost, serviceName)
	nextPort, err := reserveAutoPort(service.BindHost, excludedPorts)
	if err != nil {
		return ResolvedService{}, ResolvedManifest{}, err
	}

	if service.Health.Kind == HealthKindTCP && !service.Health.fixedTCPPort {
		service.Health.Port = copyIntPointer(nextPort)
	}
	service.Port = &nextPort

	nextManifest := value
	nextManifest.Services = copyResolvedServices(value.Services)
	nextManifest.Services[serviceName] = service
	if value.configuration != nil {
		nextManifest, err = resolveReloadPorts(*value.configuration, nextManifest, value.requested)
		if err != nil {
			return ResolvedService{}, ResolvedManifest{}, err
		}
		// Port resolution uses configured paths; retain the selected worktree.
		for name, selected := range value.Services {
			next := nextManifest.Services[name]
			next.Cwd = selected.Cwd
			nextManifest.Services[name] = next
		}
		service = nextManifest.Services[serviceName]
	}

	return service, nextManifest, nil
}

func collectExcludedRuntimePorts(value ResolvedManifest, bindHost string, targetServiceName string) map[int]struct{} {
	excludedPorts := map[int]struct{}{}
	for serviceName, service := range value.Services {
		if service.BindHost != bindHost || service.Port == nil || serviceName == targetServiceName {
			continue
		}

		excludedPorts[*service.Port] = struct{}{}
	}

	targetService, ok := value.Services[targetServiceName]
	if ok && targetService.Port != nil {
		excludedPorts[*targetService.Port] = struct{}{}
	}

	return excludedPorts
}

func copyResolvedServices(value map[string]ResolvedService) map[string]ResolvedService {
	copyValue := map[string]ResolvedService{}
	for serviceName, service := range value {
		copyValue[serviceName] = service
	}

	return copyValue
}

func copyStringPointer(value string) *string {
	copyValue := value
	return &copyValue
}

func copyIntPointer(value int) *int {
	copyValue := value
	return &copyValue
}
