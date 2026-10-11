package services

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// ValidateRequestedServices rejects names outside the manifest's services and groups.
func ValidateRequestedServices(value manifest.Manifest, requested []string) error {
	var unknown []string
	for _, name := range requested {
		_, service := value.Services[name]
		_, group := value.Groups[name]
		if !service && !group {
			unknown = append(unknown, strconv.Quote(name))
		}
	}
	if len(unknown) == 0 {
		return nil
	}

	defined := make([]string, 0, len(value.Services)+len(value.Groups))
	for name := range value.Services {
		defined = append(defined, name)
	}
	for name := range value.Groups {
		defined = append(defined, name)
	}
	sort.Strings(defined)

	subject := "unknown service"
	if len(unknown) > 1 {
		subject = "unknown services"
	}
	if len(value.Groups) > 0 {
		subject = "unknown service or group"
		if len(unknown) > 1 {
			subject = "unknown services or groups"
		}
	}
	return fmt.Errorf("%s: %s; the manifest defines: %s", subject, strings.Join(unknown, ", "), strings.Join(defined, ", "))
}

// startedServiceNames returns the services a run starts: every service when none
// is requested, otherwise the requested services, group members, and alwaysStart
// services together with everything they depend on. A requested name the manifest
// no longer defines selects nothing, so a reload keeps the rest of the selection.
func startedServiceNames(value manifest.Manifest, requested []string) map[string]bool {
	started := map[string]bool{}
	if len(requested) == 0 {
		for name := range value.Services {
			started[name] = true
		}
		return started
	}

	var pending []string
	for _, name := range requested {
		if members, ok := value.Groups[name]; ok {
			pending = append(pending, members...)
		} else {
			pending = append(pending, name)
		}
	}
	for name, service := range value.Services {
		if service.AlwaysStart {
			pending = append(pending, name)
		}
	}
	for len(pending) > 0 {
		name := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		service, ok := value.Services[name]
		if !ok || started[name] {
			continue
		}
		started[name] = true
		pending = append(pending, service.DependsOn...)
	}
	return started
}
