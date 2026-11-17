package services

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
)

func remoteManifestHosts(value manifest.Manifest, settings remote.Settings) (manifest.Manifest, error) {
	localSuffix := settings.LocalSuffix
	if localSuffix == "" {
		localSuffix = ".localhost"
	}
	value.Services = maps.Clone(value.Services)
	routes := map[string]string{}
	for _, name := range slices.Sorted(maps.Keys(value.Services)) {
		service := value.Services[name]
		service.Hosts = slices.Clone(service.Hosts)
		for i, host := range service.Hosts {
			switch {
			case settings.DomainSuffix == "":
				return manifest.Manifest{}, fmt.Errorf("remote domainSuffix is required")
			case strings.HasSuffix(host, settings.DomainSuffix):
			case strings.HasSuffix(host, localSuffix):
				host = strings.TrimSuffix(host, localSuffix) + settings.DomainSuffix
			default:
				return manifest.Manifest{}, fmt.Errorf("service %s hostname %q must end with remote.localSuffix %q or remote.domainSuffix %q", name, host, localSuffix, settings.DomainSuffix)
			}
			if !manifest.IsValidHost(host) {
				return manifest.Manifest{}, fmt.Errorf("service %s remote hostname %q is invalid", name, host)
			}
			if service.Path != nil {
				key := host + " " + *service.Path
				if previous, exists := routes[key]; exists {
					return manifest.Manifest{}, fmt.Errorf("remote route %s is duplicated by services %s and %s", key, previous, name)
				}
				routes[key] = name
			}
			service.Hosts[i] = host
		}
		value.Services[name] = service
	}
	return value, nil
}

func (m ResolvedManifest) publicHTTPSPort() int {
	if m.Remote != nil {
		return 443
	}
	return m.Caddy.HTTPSPort
}

func (m ResolvedManifest) serviceURLs(service ResolvedService) []string {
	if m.Remote != nil {
		// Unrouted dependencies have no public preview URL.
		return readManagedServiceURLs(service, m.publicHTTPSPort())
	}
	return readServiceURLs(service, m.publicHTTPSPort())
}

func (r *stackRuntime) remoteOptions(m ResolvedManifest) (remote.Options, error) {
	host, err := caddy.ResolveProxyHost(m.Caddy.BindHost)
	if err != nil {
		return remote.Options{}, err
	}
	return remote.Options{
		StateDirectory: r.routes.paths.StateDirectoryPath,
		ManifestPath:   m.ManifestPath,
		Settings:       *m.Remote,
		Hosts:          collectClaimedHosts(m.Services),
		Backend:        remote.Backend{Scheme: "https", Address: caddy.FormatProxyAddress(host, m.Caddy.HTTPSPort), RootCertificatePath: r.routes.paths.RootCertificatePath},
	}, nil
}

func (r *stackRuntime) acquireRemote(ctx context.Context) error {
	if r.manifest.Remote == nil {
		return nil
	}
	options, err := r.remoteOptions(*r.manifest)
	if err != nil {
		return err
	}
	lease, err := remote.Acquire(ctx, options)
	if err != nil {
		return fmt.Errorf("start remote previews: %w", err)
	}
	r.remoteLease = lease
	return nil
}

func (r *stackRuntime) updateRemote(ctx context.Context, m ResolvedManifest) error {
	if r.remoteLease == nil {
		return nil
	}
	options, err := r.remoteOptions(m)
	if err != nil {
		return err
	}
	return r.remoteLease.Update(ctx, options)
}

func (r *stackRuntime) checkRemoteSettings(next *remote.Settings) error {
	current := r.manifest.Remote
	if current != nil && (next == nil || *next != *current) {
		return fmt.Errorf("remote settings changed while this stack is running; stop all remote stacks, then start them again with --remote to apply the new settings")
	}
	return nil
}
