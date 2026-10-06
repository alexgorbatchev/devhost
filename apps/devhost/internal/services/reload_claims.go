package services

import (
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func manifestFixedPortClaims(m ResolvedManifest) []claimedFixedPort {
	var ports []claimedFixedPort
	for _, service := range m.Services {
		if service.PortSource == "fixed" && service.Port != nil {
			ports = append(ports, claimedFixedPort{bindHost: service.BindHost, port: *service.Port})
		}
	}
	return ports
}

func (r *stackRuntime) claimReload(m ResolvedManifest) (func() error, error) {
	previousHosts := slices.Clone(r.claimedHosts)
	previousPorts := slices.Clone(r.claimedFixedPorts)
	rollback := func() error { return r.releaseClaimsExcept(previousHosts, previousPorts) }
	paths := r.routes.paths
	for _, port := range manifestFixedPortClaims(m) {
		if slices.Contains(r.claimedFixedPorts, port) {
			continue
		}
		if err := caddy.ClaimFixedPort(caddy.ClaimFixedPortOptions{BindHost: port.bindHost, Port: port.port, ManifestPath: m.ManifestPath, PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath, KillZombies: m.KillZombies, LogWriter: r.options.LogWriter}); err != nil {
			return rollback, err
		}
		r.claimedFixedPorts = append(r.claimedFixedPorts, port)
	}
	for _, host := range collectClaimedHosts(m.Services) {
		if slices.Contains(r.claimedHosts, host) {
			continue
		}
		if err := caddy.ClaimHost(caddy.ClaimHostOptions{Host: host, ManifestPath: m.ManifestPath, RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath, KillZombies: m.KillZombies, LogWriter: r.options.LogWriter}); err != nil {
			return rollback, err
		}
		r.claimedHosts = append(r.claimedHosts, host)
	}
	return rollback, nil
}

func (r *stackRuntime) releaseClaimsExcept(hosts []string, ports []claimedFixedPort) error {
	paths := r.routes.paths
	var result error
	var retainedHosts []string
	for _, host := range r.claimedHosts {
		if slices.Contains(hosts, host) {
			retainedHosts = append(retainedHosts, host)
			continue
		}
		err := caddy.ReleaseHostClaim(caddy.ClaimHostOptions{Host: host, ManifestPath: r.manifest.ManifestPath, RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath})
		if err != nil {
			result = appendCleanupError(result, err)
			retainedHosts = append(retainedHosts, host)
		}
	}
	r.claimedHosts = retainedHosts
	var retainedPorts []claimedFixedPort
	for _, port := range r.claimedFixedPorts {
		if slices.Contains(ports, port) {
			retainedPorts = append(retainedPorts, port)
			continue
		}
		err := caddy.ReleaseFixedPortClaim(caddy.ClaimFixedPortOptions{BindHost: port.bindHost, Port: port.port, ManifestPath: r.manifest.ManifestPath, PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath})
		if err != nil {
			result = appendCleanupError(result, err)
			retainedPorts = append(retainedPorts, port)
		}
	}
	r.claimedFixedPorts = retainedPorts
	return result
}
