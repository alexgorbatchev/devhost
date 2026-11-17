package remote

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path"
	"strings"
	"time"
)

func servePreview(dir string, writer http.ResponseWriter, request *http.Request) {
	host := strings.ToLower(request.Host)
	if name, port, err := net.SplitHostPort(host); err == nil {
		if port != "443" {
			http.NotFound(writer, request)
			return
		}
		host = name
	}
	var backend Backend
	matched := false
	err := withLock(request.Context(), dir, func() error {
		leases, err := readLeases(dir)
		if err != nil {
			return err
		}
		for _, lease := range leases {
			for _, allowed := range lease.Hosts {
				if host == allowed {
					backend, matched = lease.Backend, true
					return nil
				}
			}
		}
		return nil
	})
	if err != nil {
		http.Error(writer, "Remote preview route is unavailable.", http.StatusServiceUnavailable)
		return
	}
	if !matched {
		http.NotFound(writer, request)
		return
	}
	// The Caddy hop is loopback. Preserve the config editor's local-only write
	// boundary instead of accidentally giving remote requests local privileges.
	cleanPath := path.Clean(request.URL.Path)
	if strings.HasPrefix(cleanPath+"/", "/__devhost__/config/") && request.Method != http.MethodGet && request.Method != http.MethodHead && request.Method != http.MethodOptions {
		http.Error(writer, "Configuration editing is available on the local machine.", http.StatusForbidden)
		return
	}
	transport, err := backendTransport(backend, host)
	if err != nil {
		http.Error(writer, "The local preview certificate is unavailable.", http.StatusBadGateway)
		return
	}
	defer transport.CloseIdleConnections()
	proxy := &httputil.ReverseProxy{
		Transport: transport,
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme = backend.Scheme
			r.Out.URL.Host = backend.Address
			r.Out.Host = r.In.Host
			r.Out.Header.Set("X-Forwarded-Proto", "https")
			r.Out.Header.Set("X-Forwarded-Host", r.In.Host)
			if forwarded := r.In.Header.Values("X-Forwarded-For"); len(forwarded) > 0 {
				r.Out.Header["X-Forwarded-For"] = append([]string{}, forwarded...)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "The local preview is unavailable.", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(writer, request)
}

func backendTransport(backend Backend, hostname string) (*http.Transport, error) {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	if backend.Scheme == "https" {
		pem, err := os.ReadFile(backend.RootCertificatePath)
		if err != nil {
			return nil, err
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("Caddy root certificate is invalid")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: roots, ServerName: hostname, MinVersion: tls.VersionTLS12}
	}
	return transport, nil
}
