package services

import (
	"fmt"
	"net/http"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

// stackRoutes is owned by startup and the serialized restart operation.
type stackRoutes struct {
	manifest        ResolvedManifest
	paths           caddy.Paths
	outputWriters   caddy.RouteCommandOutputWriters
	controlServer   *devtools.ControlServer
	runtime         *stackRuntime
	restartService  func(string) error
	documentServers map[string]*devtools.DocumentInjectionServer
	active          map[string]caddy.ActivateRouteOptions
}

func (r *stackRoutes) activate(service ResolvedService) error {
	if len(service.Hosts) == 0 || service.Port == nil {
		return nil
	}
	previous, hadRoute := r.active[service.Name]
	options, documentServer, err := r.prepare(service)
	if err != nil {
		return err
	}
	registrations := serviceRouteRegistrations(service, options)
	if err := caddy.ActivateRoutes(registrations, r.manifest.ManifestPath, r.paths.RoutesDirectoryPath); err != nil {
		if hadRoute && documentServer != nil {
			host, restoreError := caddy.ResolveProxyHost(previous.AppBindHost)
			if restoreError != nil {
				return fmt.Errorf("restore document backend after %v: %w", err, restoreError)
			}
			documentServer.SetBackend(host, previous.AppPort)
		}
		return fmt.Errorf("refresh route for service %s: %w", service.Name, err)
	}
	r.active[service.Name] = options
	return nil
}

func (r *stackRoutes) prepare(service ResolvedService) (caddy.ActivateRouteOptions, *devtools.DocumentInjectionServer, error) {
	options := r.options(service)
	host, err := caddy.ResolveProxyHost(service.BindHost)
	if err != nil {
		return options, nil, err
	}
	documentServer := r.documentServers[service.Name]
	if documentServer == nil {
		name := service.Name
		var worktrees http.Handler
		if r.controlServer != nil {
			worktrees = r.controlServer.RecoveryWorktrees()
		}
		documentServer, err = startDocumentInjectionServer(devtools.StartDocumentInjectionServerOptions{
			BackendHost: host, BackendPort: *service.Port,
			ShouldInject: func() bool { return r.runtime.injectsDevtools(name) },
			GetRecovery:  func() devtools.RecoveryState { return r.runtime.recovery(name) },
			Restart:      func() error { return r.restartService(name) },
			Worktrees:    worktrees,
		})
		if err != nil {
			return options, nil, err
		}
		r.documentServers[service.Name] = documentServer
	} else {
		documentServer.SetBackend(host, *service.Port)
	}
	if r.controlServer != nil && injectsDevtools(r.manifest, service) {
		options.DevtoolsControlPort = r.controlServer.Port()
	}
	options.DocumentInjectionPort = documentServer.Port()
	return options, documentServer, nil
}

// injectsDevtools reports whether service's documents carry the devtools under
// m: some devtools feature is on and the service is mounted where the injected
// script's root-relative URLs reach the control server.
func injectsDevtools(m ResolvedManifest, service ResolvedService) bool {
	return hasEnabledDevtools(m.Devtools) && isRootCompatibleServicePath(service.Path)
}

// injectsDevtools reads the running configuration for each document, so a
// reload turns injection on or off without replacing the document server.
func (r *stackRuntime) injectsDevtools(name string) bool {
	r.manifestMu.RLock()
	defer r.manifestMu.RUnlock()
	service, ok := r.manifest.Services[name]
	return ok && injectsDevtools(*r.manifest, service)
}

func serviceRouteRegistrations(service ResolvedService, options caddy.ActivateRouteOptions) []caddy.ActivateRouteOptions {
	registrations := make([]caddy.ActivateRouteOptions, 0, len(service.Hosts))
	for _, host := range service.Hosts {
		registration := options
		registration.Host = host
		registrations = append(registrations, registration)
	}
	return registrations
}

func (r *stackRoutes) options(service ResolvedService) caddy.ActivateRouteOptions {
	path := "/"
	if service.Path != nil {
		path = *service.Path
	}
	return caddy.ActivateRouteOptions{
		ProxyLocalOrigin: service.ProxyLocalOrigin,
		AppBindHost:      service.BindHost, AppPort: *service.Port,
		CaddyOutputWriters: r.outputWriters,
		Host:               service.Hosts[0],
		Path:               path, ServiceName: service.Name, AccessLogName: stackAccessLogName(r.manifest),
	}
}

// stackAccessLogName names the access log after the stack's identity, its root
// manifest path, so the idle timeout keeps seeing traffic across renames. A
// manifest-free session has no manifest path, and its name, which holds its
// domain, does not change while it runs.
func stackAccessLogName(m ResolvedManifest) string {
	if m.ManifestPath == "" {
		return m.Name
	}
	return "stack-" + worktreeKey(m.ManifestPath)[:12]
}
