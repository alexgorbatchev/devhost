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

// StartFiles runs a foreground, manifest-free session using the same route,
// devtools, ownership, and signal cleanup as a configured stack.
func StartFiles(directory, domain string, options StartStackOptions) (code int, err error) {
	if !manifest.IsValidHost(domain) {
		return 0, fmt.Errorf("invalid domain %q; use a hostname such as notes.localhost", domain)
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return 0, fmt.Errorf("resolve served directory: %w", err)
	}
	handler, err := files.Open(directory)
	if err != nil {
		return 0, err
	}
	defer func() { err = errors.Join(err, handler.Close()) }()
	paths, err := resolveStartStackPaths(options.CaddyPaths, options.Environment)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(paths.StateDirectoryPath, 0o700); err != nil {
		return 0, fmt.Errorf("create file session state directory: %w", err)
	}
	runtimeDir, err := os.MkdirTemp(paths.StateDirectoryPath, "files-")
	if err != nil {
		return 0, fmt.Errorf("create file session runtime directory: %w", err)
	}
	defer func() { err = errors.Join(err, os.RemoveAll(runtimeDir)) }()
	options.CaddyPaths = paths
	options.runtimeDirectoryPath = runtimeDir
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("start file listener: %w", err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	serveErrors := make(chan error, 1)
	var serverWG sync.WaitGroup
	serverWG.Go(func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErrors <- fmt.Errorf("serve directory: %w", err)
		}
	})
	defer func() { err = errors.Join(err, server.Close()); serverWG.Wait() }()
	port := listener.Addr().(*net.TCPAddr).Port
	const serviceName = "files"
	const bindHost = "127.0.0.1"
	resolved := ResolvedManifest{
		ManifestDirectoryPath: directory, Name: "files-" + domain, PrimaryService: serviceName,
		Devtools: manifest.DefaultDevtools(), ServiceOrder: []string{serviceName},
		Services: map[string]ResolvedService{serviceName: {
			Name: serviceName, Cwd: directory, BindHost: bindHost, Hosts: []string{domain}, Path: new("/"), Port: &port,
			Health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: new(bindHost), Port: &port, Interval: defaultHealthInterval, Timeout: defaultHealthTimeout},
		}},
	}
	options.fileSession = true
	options.runtimeErrors = serveErrors
	return StartStack(&resolved, resolved.ServiceOrder, options)
}
