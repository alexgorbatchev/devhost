package services

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/files"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// StartServe runs a foreground, manifest-free session using the same route,
// devtools, ownership, and signal cleanup as a configured stack.
// A zero port serves directory; a nonzero port belongs to an external service.
func StartServe(directory, domain string, port int, options StartStackOptions) (code int, err error) {
	if !manifest.IsValidHost(domain) {
		return 0, fmt.Errorf("invalid domain %q; use a hostname such as notes.localhost", domain)
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return 0, fmt.Errorf("resolve served directory: %w", err)
	}
	if port < 0 || port > 65535 {
		return 0, fmt.Errorf("port must be between 1 and 65535")
	}
	paths, err := resolveStartStackPaths(options.CaddyPaths, options.Environment)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(paths.StateDirectoryPath, 0o700); err != nil {
		return 0, fmt.Errorf("create serve session state directory: %w", err)
	}
	options.CaddyPaths = paths
	if port == 0 {
		var closeServer func() error
		port, options.runtimeErrors, closeServer, err = startFileServer(directory)
		if err != nil {
			return 0, err
		}
		defer func() { err = errors.Join(err, closeServer()) }()
	}
	const serviceName = "serve"
	const bindHost = "127.0.0.1"
	resolved := ResolvedManifest{
		ManifestDirectoryPath: directory, Name: "serve-" + domain, PrimaryService: serviceName,
		Devtools: manifest.DefaultDevtools(), ServiceOrder: []string{serviceName},
		Services: map[string]ResolvedService{serviceName: {
			Name: serviceName, Cwd: directory, BindHost: bindHost, Hosts: []string{domain}, Path: new("/"), Port: &port,
			Health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: new(bindHost), Port: &port, Interval: defaultHealthInterval, Timeout: defaultHealthTimeout},
		}},
	}
	options.serveSession = true
	return StartStack(&resolved, resolved.ServiceOrder, options)
}

func startFileServer(directory string) (int, <-chan error, func() error, error) {
	handler, err := files.Open(directory)
	if err != nil {
		return 0, nil, nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, nil, nil, errors.Join(fmt.Errorf("start file listener: %w", err), handler.Close())
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	serveErrors := make(chan error, 1)
	var serverWG sync.WaitGroup
	serverWG.Go(func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErrors <- fmt.Errorf("serve directory: %w", err)
		}
	})
	closeServer := func() error {
		err := server.Close()
		serverWG.Wait()
		return errors.Join(err, handler.Close())
	}
	return listener.Addr().(*net.TCPAddr).Port, serveErrors, closeServer, nil
}
