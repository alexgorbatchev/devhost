package services

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// ValidateRequestedServices rejects service names the manifest does not define.
func ValidateRequestedServices(value manifest.Manifest, requested []string) error {
	var unknown []string
	for _, name := range requested {
		if _, ok := value.Services[name]; !ok {
			unknown = append(unknown, strconv.Quote(name))
		}
	}
	if len(unknown) == 0 {
		return nil
	}

	defined := make([]string, 0, len(value.Services))
	for name := range value.Services {
		defined = append(defined, name)
	}
	sort.Strings(defined)

	subject := "unknown service"
	if len(unknown) > 1 {
		subject = "unknown services"
	}
	return fmt.Errorf("%s: %s; the manifest defines: %s", subject, strings.Join(unknown, ", "), strings.Join(defined, ", "))
}

// startedServiceNames returns the services a run starts: every service when none
// is requested, otherwise the requested and alwaysStart services together with
// everything they depend on. A requested name the manifest no longer defines
// selects nothing, so a reload that removes it keeps the rest of the selection.
func startedServiceNames(value manifest.Manifest, requested []string) map[string]bool {
	started := map[string]bool{}
	if len(requested) == 0 {
		for name := range value.Services {
			started[name] = true
		}
		return started
	}

	pending := slices.Clone(requested)
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
