package services

import (
	"errors"
	"fmt"
	"maps"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func (r *stackRoutes) registrations() []caddy.ActivateRouteOptions {
	var result []caddy.ActivateRouteOptions
	for name, options := range r.active {
		result = append(result, serviceRouteRegistrations(r.manifest.Services[name], options)...)
	}
	return result
}

func (r *stackRoutes) replace(next ResolvedManifest) (returnedError error) {
	previous := r.manifest
	oldDocuments := maps.Clone(r.documentServers)
	published := false
	defer func() {
		if returnedError == nil || published {
			return
		}
		r.manifest = previous
		for name, document := range r.documentServers {
			if oldDocuments[name] == nil {
				returnedError = errors.Join(returnedError, document.Stop())
				delete(r.documentServers, name)
			} else if backend, ok := r.active[name]; ok {
				host, err := caddy.ResolveProxyHost(backend.AppBindHost)
				if err != nil {
					returnedError = errors.Join(returnedError, err)
				} else {
					document.SetBackend(host, backend.AppPort)
				}
			}
		}
	}()
	oldRoutes := r.registrations()
	r.manifest = next
	active := map[string]caddy.ActivateRouteOptions{}
	var registrations []caddy.ActivateRouteOptions
	for _, name := range orderedManifestServiceNames(next) {
		service := next.Services[name]
		if len(service.Hosts) == 0 || service.Port == nil {
			continue
		}
		options, _, err := r.prepare(service)
		if err != nil {
			return err
		}
		active[name] = options
		registrations = append(registrations, serviceRouteRegistrations(service, options)...)
	}
	if err := caddy.ReplaceRoutes(oldRoutes, registrations, next.ManifestPath, r.paths.RoutesDirectoryPath); err != nil {
		return fmt.Errorf("replace stack routes: %w", err)
	}
	r.active = active
	published = true
	// Keep document listeners through service restarts and route changes. Removed
	// services' listeners are closed only after Caddy accepts the replacement.
	for name, document := range r.documentServers {
		if options, exists := active[name]; exists && options.DocumentInjectionPort != 0 {
			continue
		}
		if err := document.Stop(); err != nil {
			return fmt.Errorf("stop document server for %s: %w", name, err)
		}
		delete(r.documentServers, name)
	}
	return nil
}
