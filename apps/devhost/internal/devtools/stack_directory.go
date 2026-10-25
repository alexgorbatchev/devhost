package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const (
	stackDirectoryPath   = controlPathPrefix + "/stacks"
	stackSnapshotPath    = stackDirectoryPath + "/self"
	stackSnapshotTimeout = 2 * time.Second
	stackSnapshotLimit   = 16 << 20
)

// Directory requests contain local paths and configuration sources. The reserved
// hostname grants access to these read-only routes, never other stack controls.
func (s *ControlServer) guardStackDirectory(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	w.Header().Set("Referrer-Policy", "no-referrer")
	settings, _, err := caddy.ReadAppliedManagedCaddySettings(s.stackDirectoryPaths)
	if err != nil {
		http.Error(w, "Stack directory settings unavailable", http.StatusServiceUnavailable)
		return false
	}
	if !isLocalClient(r) && !(settings.StackDirectoryAllowRemote && r.URL.Path == stackDirectoryPath) {
		http.Error(w, "The stack directory is available on this machine only.", http.StatusForbidden)
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	host := r.Host
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	if err := crossOriginProtection.Check(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != requestDocumentOrigin(r) {
		http.Error(w, "Cross-origin directory request", http.StatusForbidden)
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); (site == "cross-site" || site == "same-site") && r.Header.Get("Sec-Fetch-Mode") != "navigate" {
		http.Error(w, "Cross-origin directory request", http.StatusForbidden)
		return false
	}
	directoryHost := settings.StackDirectoryHostname()
	if !strings.EqualFold(host, directoryHost) && !s.servesRequestHost(r) {
		http.Error(w, "Unknown stack directory host", http.StatusForbidden)
		return false
	}
	return true
}

func (s *ControlServer) stackSnapshot() (statuspage.Stack, error) {
	stack := statuspage.Stack{Name: s.currentSettings().StackName, Directory: s.projectRootPath}
	if s.getStackServices != nil {
		services, err := s.getStackServices()
		if err != nil {
			return stack, err
		}
		stack.Services = services
	}
	if s.listConfigFiles == nil {
		return stack, nil
	}
	refs, err := s.listConfigFiles()
	if err != nil {
		return stack, err
	}
	for _, ref := range refs {
		config := statuspage.StackConfig{Path: ref.Path, Kind: string(ref.Kind)}
		file, err := readConfigFile(ref)
		if err != nil {
			config.Error = err.Error()
		} else if file.Version == "" {
			config.Error = "File does not exist; defaults apply."
		} else {
			config.Content = file.Content
		}
		stack.Configs = append(stack.Configs, config)
	}
	return stack, nil
}

func (s *ControlServer) handleStackSnapshot(w http.ResponseWriter, r *http.Request) {
	if !s.guardStackDirectory(w, r) {
		return
	}
	stack, err := s.stackSnapshot()
	if err != nil {
		stack.Error = err.Error()
	}
	w.Header().Set("Content-Type", jsonMediaType)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(stack) // Delivery to a disconnected directory reader is best-effort.
	}
}

func (s *ControlServer) handleStackDirectory(w http.ResponseWriter, r *http.Request) {
	if !s.guardStackDirectory(w, r) {
		return
	}
	owners, err := caddy.ReadLiveStacks(s.stackDirectoryPaths)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	stacks := make([]statuspage.Stack, len(owners))
	// Each stack has a deadline; one busy stack cannot hold every other one up.
	var wg sync.WaitGroup
	for i, owner := range owners {
		wg.Go(func() {
			stack, err := readStackSnapshot(r.Context(), owner)
			if err != nil {
				stack.Error = "Stack details unavailable: " + err.Error()
			}
			stack.PID, stack.ManifestPath, stack.StartedAt = owner.PID, owner.ManifestPath, owner.StartedAt
			if stack.Name == "" {
				stack.Name = owner.Name
			}
			if stack.Directory == "" && owner.ManifestPath != "" {
				stack.Directory = filepath.Dir(owner.ManifestPath)
			}
			stacks[i] = stack
		})
	}
	wg.Wait()
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	filtered := make([]statuspage.Stack, 0, len(stacks))
	for _, stack := range stacks {
		if stackMatches(stack, strings.ToLower(query)) {
			filtered = append(filtered, stack)
		}
	}
	document, err := statuspage.StackDirectory(filtered, query)
	if err != nil {
		http.Error(w, "Could not render stack directory", http.StatusInternalServerError)
		return
	}
	servePreviewDocument(w, r, document, http.StatusOK)
}

func readStackSnapshot(ctx context.Context, owner caddy.LiveStack) (statuspage.Stack, error) {
	if owner.ControlPort <= 0 || owner.ControlPort > 65535 {
		return statuspage.Stack{}, fmt.Errorf("control server is not available")
	}
	ctx, cancel := context.WithTimeout(ctx, stackSnapshotTimeout)
	defer cancel()
	href := fmt.Sprintf("http://127.0.0.1:%d%s", owner.ControlPort, stackSnapshotPath)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, href, nil)
	if err != nil {
		return statuspage.Stack{}, err
	}
	// Connect only to the loopback address in the record. Ignore proxy environment
	// variables and redirects, so configuration never leaves the local machine.
	client := http.Client{Transport: stackSnapshotTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return statuspage.Stack{}, err
	}
	defer response.Body.Close() // Read-only response; close errors do not affect the snapshot.
	if response.StatusCode != http.StatusOK {
		return statuspage.Stack{}, fmt.Errorf("control server returned %s", response.Status)
	}
	var stack statuspage.Stack
	if err := json.NewDecoder(io.LimitReader(response.Body, stackSnapshotLimit)).Decode(&stack); err != nil {
		return stack, err
	}
	return stack, nil
}

var stackSnapshotTransport = &http.Transport{DisableKeepAlives: true}

func stackMatches(stack statuspage.Stack, query string) bool {
	values := []string{stack.Name, stack.Directory, stack.ManifestPath}
	for _, service := range stack.Services {
		values = append(values, service.Name, service.Directory)
		values = append(values, service.URLs...)
	}
	for _, file := range stack.Configs {
		values = append(values, file.Path)
	}
	return strings.Contains(strings.ToLower(strings.Join(values, "\n")), query)
}
