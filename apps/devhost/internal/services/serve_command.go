package services

import (
	"context"
	"crypto/rand"
	"fmt"
	"maps"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	processnet "github.com/shirou/gopsutil/v4/net"
)

const commandServiceName = "command"
const commandDiscoveryInterval = 500 * time.Millisecond

type ServeCommandOptions struct {
	Directory      string
	Command        []string
	Name           string
	Session        string
	StartupTimeout time.Duration
	Environment    map[string]string
}

// ResolveServeCommand fixes the session identity before a possible detached launch.
func ResolveServeCommand(options ServeCommandOptions) (ResolvedManifest, error) {
	directory, command, name, session, timeout, environment := options.Directory, options.Command, options.Name, options.Session, options.StartupTimeout, options.Environment
	if len(command) == 0 || timeout <= 0 {
		return ResolvedManifest{}, fmt.Errorf("command and positive startup timeout are required")
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		return ResolvedManifest{}, err
	}
	path, err := config.Path(environment)
	if err != nil {
		return ResolvedManifest{}, err
	}
	shared, err := config.Read(path)
	if err != nil {
		return ResolvedManifest{}, err
	}
	// A hyphen-prefixed machine suffix shares the session's first DNS label.
	suffixLabel, _, _ := strings.Cut(shared.DomainSuffix, ".")
	nameLimit := 48 - len(suffixLabel)
	if nameLimit < 1 {
		return ResolvedManifest{}, fmt.Errorf("domain suffix leaves no room for command session hostnames")
	}
	if session == "" {
		if name == "" {
			name = inferServeName(directory, command)
		}
		name = serveNameLabel(name)
		if len(name) > nameLimit {
			name = strings.TrimRight(name[:nameLimit], "-")
		}
		id := make([]byte, 4)
		if _, err := rand.Read(id); err != nil {
			return ResolvedManifest{}, fmt.Errorf("generate session ID: %w", err)
		}
		session = fmt.Sprintf("%s-%x", name, id)
	}
	if !manifest.IsValidHost(session+"-65535"+shared.DomainSuffix) || strings.Contains(session, ".") || len(session) > 57-len(suffixLabel) {
		return ResolvedManifest{}, fmt.Errorf("invalid command session label %q", session)
	}
	service := ResolvedService{Name: commandServiceName, Command: slices.Clone(command), Cwd: directory, Managed: true,
		Health: ResolvedHealthConfig{Kind: HealthKindProcess, Interval: defaultHealthInterval, Timeout: int(timeout.Milliseconds())}}
	return ResolvedManifest{ManifestDirectoryPath: directory, Name: session, DomainSuffix: shared.DomainSuffix, Caddy: shared.Caddy,
		PrimaryService: commandServiceName, Devtools: manifest.DefaultDevtools(), ServiceOrder: []string{commandServiceName}, Services: map[string]ResolvedService{commandServiceName: service}}, nil
}

// StartServeCommand runs discovery inside the normal stack's ownership boundary.
func StartServeCommand(m *ResolvedManifest, timeout time.Duration, options StartStackOptions) (int, error) {
	options.serveSession = true
	options.commandServe = &commandServe{timeout: timeout, qualified: map[int]bool{}, rejected: map[int]bool{}}
	return StartStack(m, m.ServiceOrder, options)
}

type commandServe struct {
	timeout   time.Duration
	aliasPort int
	qualified map[int]bool
	rejected  map[int]bool
}

type commandListener struct {
	port int
	host string
}

// readCommandListeners scopes the kernel socket query to the contained process tree.
func readCommandListeners(ctx context.Context, started *startedService) ([]commandListener, error) {
	pids := []int{started.cmd.Process.Pid}
	if started.containment != nil {
		snapshot, err := readProcessSnapshot()
		if err != nil {
			return nil, fmt.Errorf("discover command descendants: %w", err)
		}
		pids = append(pids, collectDescendantPIDs(snapshot, started.cmd.Process.Pid)...)
		for _, pid := range collectPlatformContainmentRootPIDs(snapshot, started.containment.serviceToken) {
			pids = append(pids, pid)
			pids = append(pids, collectDescendantPIDs(snapshot, pid)...)
		}
	}
	slices.Sort(pids)
	pids = slices.Compact(pids)
	byPort := map[int]commandListener{}
	for _, pid := range pids {
		connections, err := processnet.ConnectionsPidWithoutUidsWithContext(ctx, "tcp", int32(pid))
		if err != nil {
			if !processExists(pid) {
				continue
			}
			return nil, fmt.Errorf("discover listeners for PID %d: %w", pid, err)
		}
		for _, connection := range connections {
			if connection.Status != "LISTEN" || connection.Laddr.Port == 0 {
				continue
			}
			host := connection.Laddr.IP
			if host == "*" || host == "" {
				host = "127.0.0.1"
				if connection.Family == syscall.AF_INET6 {
					host = "::1"
				}
			}
			if ip := net.ParseIP(host); ip != nil && ip.IsUnspecified() {
				if ip.To4() != nil {
					host = "127.0.0.1"
				} else {
					host = "::1"
				}
			}
			port := int(connection.Laddr.Port)
			candidate := commandListener{port: port, host: host}
			if old, ok := byPort[port]; !ok || candidate.host < old.host {
				byPort[port] = candidate
			}
		}
	}
	ports := slices.Sorted(maps.Keys(byPort))
	result := make([]commandListener, 0, len(ports))
	for _, port := range ports {
		result = append(result, byPort[port])
	}
	return result, nil
}

func isHTTPListener(ctx context.Context, listener commandListener) bool {
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, ResponseHeaderTimeout: 300 * time.Millisecond}
	defer transport.CloseIdleConnections()
	client := http.Client{Transport: transport, Timeout: 400 * time.Millisecond, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, "http://"+net.JoinHostPort(listener.host, strconv.Itoa(listener.port))+"/", nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return true
}

func (r *stackRuntime) waitForCommandRoutes(ctx context.Context) (int, error) {
	startup, cancel := context.WithTimeout(ctx, r.options.commandServe.timeout)
	defer cancel()
	ticker := time.NewTicker(commandDiscoveryInterval)
	defer ticker.Stop()
	for {
		if err := r.refreshCommandRoutes(startup); err != nil {
			return 0, err
		}
		if len(r.manifest.Services) > 1 {
			return 0, nil
		}
		select {
		case <-startup.Done():
			if ctx.Err() != nil {
				return 0, ctx.Err()
			}
			return 0, fmt.Errorf("command opened no HTTP listener within %s", r.options.commandServe.timeout)
		case result := <-r.exits:
			return result.exitCode, fmt.Errorf("command exited with code %d before opening an HTTP listener", result.exitCode)
		case <-ticker.C:
		}
	}
}

func (r *stackRuntime) refreshCommandRoutes(ctx context.Context) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	r.startedMu.Lock()
	started := findStartedService(r.started, commandServiceName)
	r.startedMu.Unlock()
	if started == nil || started.cmd == nil {
		return fmt.Errorf("command process is unavailable")
	}
	listeners, err := readCommandListeners(ctx, started)
	if err != nil {
		return err
	}
	discovery := r.options.commandServe
	var httpListeners []commandListener
	seen := map[int]bool{}
	for _, listener := range listeners {
		seen[listener.port] = true
		previous, exists := r.manifest.Services["port-"+strconv.Itoa(listener.port)]
		if exists && previous.BindHost == listener.host || isHTTPListener(ctx, listener) {
			httpListeners = append(httpListeners, listener)
			delete(discovery.rejected, listener.port)
		} else if !discovery.rejected[listener.port] {
			cliout.Log(r.options.LogWriter, r.manifest.Name, fmt.Sprintf("Port %d is listening but has not responded to HTTP; waiting before routing it.", listener.port))
			discovery.rejected[listener.port] = true
		}
	}
	for port := range discovery.rejected {
		if !seen[port] {
			delete(discovery.rejected, port)
		}
	}
	if len(httpListeners) == 1 && discovery.aliasPort == 0 && len(discovery.qualified) == 0 {
		discovery.aliasPort = httpListeners[0].port
	}
	if len(httpListeners) > 1 {
		for _, listener := range httpListeners {
			discovery.qualified[listener.port] = true
		}
	}
	next := *r.manifest
	next.Services = map[string]ResolvedService{commandServiceName: r.manifest.Services[commandServiceName]}
	next.ServiceOrder = []string{commandServiceName}
	for _, listener := range httpListeners {
		port := listener.port
		name := "port-" + strconv.Itoa(port)
		var hosts []string
		if port == discovery.aliasPort {
			hosts = append(hosts, next.Name+next.DomainSuffix)
		}
		if discovery.qualified[port] || port != discovery.aliasPort {
			hosts = append(hosts, fmt.Sprintf("%s-%d%s", next.Name, port, next.DomainSuffix))
		}
		next.Services[name] = ResolvedService{Name: name, Cwd: next.ManifestDirectoryPath, BindHost: listener.host, Hosts: hosts, Port: new(port), Path: new("/"),
			Health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: new(listener.host), Port: new(port), Interval: defaultHealthInterval, Timeout: defaultHealthTimeout}}
		next.ServiceOrder = append(next.ServiceOrder, name)
	}
	if commandRoutesEqual(*r.manifest, next) {
		return nil
	}
	for _, host := range collectClaimedHosts(next.Services) {
		if slices.Contains(r.claimedHosts, host) {
			continue
		}
		if err := caddy.ClaimHost(caddy.ClaimHostOptions{Host: host, RegistrationsDirectoryPath: r.routes.paths.RegistrationsDirectoryPath, LogWriter: r.options.LogWriter}); err != nil {
			return err
		}
		r.claimedHosts = append(r.claimedHosts, host)
	}
	if err := r.routes.replace(next); err != nil {
		return err
	}
	previous := *r.manifest
	r.manifestMu.Lock()
	*r.manifest = next
	r.order = slices.Clone(next.ServiceOrder)
	r.manifestMu.Unlock()
	if r.control != nil {
		if err := r.control.UpdateSettings(devtoolsControlSettings(next)); err != nil {
			return err
		}
	}
	for _, name := range next.ServiceOrder {
		for _, url := range next.serviceURLs(next.Services[name]) {
			if !slices.Contains(previous.serviceURLs(previous.Services[name]), url) {
				cliout.Log(r.options.LogWriter, next.Name, url)
			}
		}
	}
	if r.ready {
		if err := r.publishStackURLs(r.routes.paths); err != nil {
			return err
		}
	}
	r.publish()
	return nil
}

func commandRoutesEqual(a, b ResolvedManifest) bool {
	if len(a.Services) != len(b.Services) {
		return false
	}
	for name, service := range b.Services {
		previous, ok := a.Services[name]
		if !ok || service.BindHost != previous.BindHost || !slices.Equal(service.Hosts, previous.Hosts) {
			return false
		}
	}
	return true
}
