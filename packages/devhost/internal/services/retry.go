package services

import (
	"fmt"
	"regexp"
	"strings"
)

const MaximumAutoPortRetryCount = 3

var autoPortBindCollisionPattern = regexp.MustCompile(`(?i)EADDRINUSE|address already in use|bind: address already in use`)

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
	nextPort, error := reserveAutoPort(service.BindHost, excludedPorts)
	if error != nil {
		return ResolvedService{}, ResolvedManifest{}, error
	}

	service.Port = &nextPort
	service.Health = ResolvedHealthConfig{
		Host:     copyStringPointer(service.BindHost),
		Interval: defaultHealthInterval,
		Kind:     "tcp",
		Port:     copyIntPointer(nextPort),
		Retries:  defaultHealthRetries,
		Timeout:  defaultHealthTimeout,
	}

	nextManifest := value
	nextManifest.Services = copyResolvedServices(value.Services)
	nextManifest.Services[serviceName] = service

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
