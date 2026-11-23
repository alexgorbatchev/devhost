package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	stackInfoPath    = controlPathPrefix + "/stack-info"
	stackInfoTimeout = 2 * time.Second
	stackInfoLimit   = 4 << 20
)

// StackServiceInfo describes one service's live state as reported by a running stack.
type StackServiceInfo struct {
	Name       string   `json:"name"`
	State      string   `json:"state"`
	Primary    bool     `json:"primary,omitempty"`
	ExitCode   *int     `json:"exitCode,omitempty"`
	Since      string   `json:"since,omitempty"`
	Port       *int     `json:"port,omitempty"`
	URLs       []string `json:"urls,omitempty"`
	LastOutput string   `json:"lastOutput,omitempty"`
}

// StackInfoSnapshot is the live runtime snapshot served to the CLI on the loopback control listener.
type StackInfoSnapshot struct {
	Name          string             `json:"name"`
	Starting      bool               `json:"starting"`
	ManifestFiles []string           `json:"manifestFiles,omitempty"`
	Services      []StackServiceInfo `json:"services"`
}

// guardStackInfo restricts stack info queries to direct local loopback callers.
func guardStackInfo(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	w.Header().Set("Referrer-Policy", "no-referrer")
	if !isLocalClient(r) {
		http.Error(w, "Stack info is available on this machine only.", http.StatusForbidden)
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	if err := crossOriginProtection.Check(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != requestDocumentOrigin(r) {
		http.Error(w, "Cross-origin stack info request", http.StatusForbidden)
		return false
	}
	if !isLoopbackHost(r.Host) {
		http.Error(w, "Stack info is available on the loopback control listener only.", http.StatusForbidden)
		return false
	}
	return true
}

func isLoopbackHost(rawHost string) bool {
	hostname := rawHost
	if host, _, err := net.SplitHostPort(rawHost); err == nil {
		hostname = host
	}
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}

func (s *ControlServer) handleStackInfo(w http.ResponseWriter, r *http.Request) {
	if !guardStackInfo(w, r) {
		return
	}
	if s.getStackInfo == nil {
		http.Error(w, "Stack info is not available.", http.StatusNotImplemented)
		return
	}
	snapshot, err := s.getStackInfo(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", jsonMediaType)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(snapshot) // Delivery to a disconnected reader is best-effort.
	}
}

// ReadStackInfo fetches the live stack info snapshot from a stack's loopback control listener.
func ReadStackInfo(ctx context.Context, controlPort int) (StackInfoSnapshot, error) {
	if controlPort <= 0 || controlPort > 65535 {
		return StackInfoSnapshot{}, fmt.Errorf("control server is not available")
	}
	ctx, cancel := context.WithTimeout(ctx, stackInfoTimeout)
	defer cancel()
	href := fmt.Sprintf("http://127.0.0.1:%d%s", controlPort, stackInfoPath)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, href, nil)
	if err != nil {
		return StackInfoSnapshot{}, err
	}
	client := http.Client{
		Transport:     stackSnapshotTransport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return StackInfoSnapshot{}, err
	}
	defer response.Body.Close() // Read-only response; close errors do not affect the snapshot.
	if response.StatusCode != http.StatusOK {
		return StackInfoSnapshot{}, fmt.Errorf("control server returned %s", response.Status)
	}
	var snapshot StackInfoSnapshot
	if err := json.NewDecoder(io.LimitReader(response.Body, stackInfoLimit)).Decode(&snapshot); err != nil {
		return StackInfoSnapshot{}, err
	}
	return snapshot, nil
}
