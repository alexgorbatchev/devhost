package services

import (
	"fmt"
	"sort"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func ResolveServiceOrder(value manifest.Manifest) ([]string, error) {
	visitingServices := map[string]struct{}{}
	visitedServices := map[string]struct{}{}
	orderedServices := []string{}

	serviceNames := orderedServiceNames(value)
	for _, serviceName := range serviceNames {
		if error := visitService(serviceName, value.Services, visitingServices, visitedServices, &orderedServices, []string{}); error != nil {
			return nil, error
		}
	}

	return orderedServices, nil
}

func visitService(
	serviceName string,
	services map[string]manifest.ValidatedService,
	visitingServices map[string]struct{},
	visitedServices map[string]struct{},
	orderedServices *[]string,
	ancestry []string,
) error {
	if _, ok := visitedServices[serviceName]; ok {
		return nil
	}

	if _, ok := visitingServices[serviceName]; ok {
		return fmt.Errorf("Dependency cycle detected: %s", joinDependencyCycle(append(ancestry, serviceName)))
	}

	visitingServices[serviceName] = struct{}{}
	for _, dependencyName := range services[serviceName].DependsOn {
		if error := visitService(
			dependencyName,
			services,
			visitingServices,
			visitedServices,
			orderedServices,
			append(ancestry, serviceName),
		); error != nil {
			return error
		}
	}

	delete(visitingServices, serviceName)
	visitedServices[serviceName] = struct{}{}
	*orderedServices = append(*orderedServices, serviceName)
	return nil
}

func joinDependencyCycle(services []string) string {
	result := ""
	for index, serviceName := range services {
		if index > 0 {
			result += " -> "
		}
		result += serviceName
	}
	return result
}

func orderedServiceNames(value manifest.Manifest) []string {
	if len(value.ServiceOrder) > 0 {
		serviceNames := []string{}
		seenServices := map[string]struct{}{}
		for _, serviceName := range value.ServiceOrder {
			if _, ok := value.Services[serviceName]; !ok {
				continue
			}
			if _, ok := seenServices[serviceName]; ok {
				continue
			}
			seenServices[serviceName] = struct{}{}
			serviceNames = append(serviceNames, serviceName)
		}
		for serviceName := range value.Services {
			if _, ok := seenServices[serviceName]; ok {
				continue
			}
			serviceNames = append(serviceNames, serviceName)
		}
		return serviceNames
	}

	serviceNames := make([]string, 0, len(value.Services))
	for serviceName := range value.Services {
		serviceNames = append(serviceNames, serviceName)
	}
	sort.Strings(serviceNames)
	return serviceNames
}
