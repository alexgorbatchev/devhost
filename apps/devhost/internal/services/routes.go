package services

import (
	"fmt"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

// stackRoutes is owned by startup and the serialized restart operation.
type stackRoutes struct {
	manifest        ResolvedManifest
	paths           caddy.Paths
	outputWriters   caddy.RouteCommandOutputWriters
	controlServer   *devtools.ControlServer
	documentServers map[string]*devtools.DocumentInjectionServer
	active          map[string]caddy.ActivateRouteOptions
	settings        caddy.ManagedCaddyGlobalSettings
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
	var documentServer *devtools.DocumentInjectionServer
	if r.controlServer != nil && isRootCompatibleServicePath(service.Path) {
		host, err := caddy.ResolveProxyHost(service.BindHost)
		if err != nil {
			return options, nil, err
		}
		documentServer = r.documentServers[service.Name]
		if documentServer == nil {
			documentServer, err = startDocumentInjectionServer(devtools.StartDocumentInjectionServerOptions{BackendHost: host, BackendPort: *service.Port})
			if err != nil {
				return options, nil, err
			}
			r.documentServers[service.Name] = documentServer
		} else {
			documentServer.SetBackend(host, *service.Port)
		}
		options.DevtoolsControlPort = r.controlServer.Port()
		options.DocumentInjectionPort = documentServer.Port()
	}
	return options, documentServer, nil
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
	options := caddy.ActivateRouteOptions{
		ProxyLocalOrigin: service.ProxyLocalOrigin,
		AppBindHost:      service.BindHost, AppPort: *service.Port,
		CaddyAdminAddress: caddy.ResolveManagedCaddyAdminAddress(r.manifest.Caddy.Global.AdminAddress),
		CaddyBindHost:     r.manifest.Caddy.Global.BindHost, CaddyOutputWriters: r.outputWriters,
		CaddyHTTPPort: r.manifest.Caddy.Global.HTTPPort, CaddyHTTPSPort: r.manifest.Caddy.Global.HTTPSPort,
		Host: service.Hosts[0], HTTPEnabled: r.manifest.Caddy.Global.HTTP,
		Path: path, ServiceName: service.Name, StackName: r.manifest.Name,
	}
	return caddy.ResolveManagedCaddyRouteOptions(options, r.settings)
}
