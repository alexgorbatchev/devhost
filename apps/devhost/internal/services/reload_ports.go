package services

import "github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"

func resolveReloadPorts(next manifest.Manifest, current ResolvedManifest, requested []string) (ResolvedManifest, error) {
	fixed := collectFixedPorts(next.Services)
	preserved := map[string]int{}
	for name, service := range next.Services {
		old, ok := current.Services[name]
		if !ok {
			old, ok = current.Stopped[name]
		}
		if !ok || service.Port == nil || !service.Port.Auto || old.PortSource != "auto" || old.Port == nil || old.BindHost != service.BindHost {
			continue
		}
		if _, occupied := fixed[service.BindHost][*old.Port]; !occupied {
			preserved[name] = *old.Port
		}
	}
	return resolveServicePorts(next, portResolutionOptions{Preserved: preserved, Requested: requested})
}

func resolveStackRestartPorts(next manifest.Manifest, current ResolvedManifest, requested []string) (ResolvedManifest, error) {
	options := portResolutionOptions{Excluded: map[string]map[int]struct{}{}, Requested: requested}
	for _, service := range current.Services {
		if service.Port == nil {
			continue
		}
		if options.Excluded[service.BindHost] == nil {
			options.Excluded[service.BindHost] = map[int]struct{}{}
		}
		options.Excluded[service.BindHost][*service.Port] = struct{}{}
	}
	return resolveServicePorts(next, options)
}
