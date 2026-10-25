package caddy

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const StackDirectoryHost = "devhost.localhost"

// StackDirectoryHostname resolves the optional shared hostname setting.
func (s ManagedCaddyGlobalSettings) StackDirectoryHostname() string {
	if s.StackDirectoryHost == "" {
		return StackDirectoryHost
	}
	return s.StackDirectoryHost
}

// ReadStackDirectoryHostname follows the configuration Caddy currently serves.
func ReadStackDirectoryHostname(paths Paths) (string, error) {
	settings, err := readRunningSettings(paths, DefaultManagedCaddyGlobalSettings())
	return settings.StackDirectoryHostname(), err
}

// LiveStack identifies a running stack and its private loopback control server.
type LiveStack struct {
	Name         string
	PID          int
	ManifestPath string
	StartedAt    string
	ControlPort  int
	record       stackRecord
}

// Signal checks that this exact registration and process still own the stack.
func (s LiveStack) Signal(paths Paths, sig os.Signal) error {
	owner := StackOccupant{ID: stackOccupantID(s.record), PID: s.PID, record: s.record}
	return owner.Signal(paths, sig)
}

func (s LiveStack) Alive() bool {
	return isRecordOwnerAlive(s.PID, s.record.OwnerStartIdentity)
}

func ReadLiveStacks(paths Paths) ([]LiveStack, error) {
	entries, err := os.ReadDir(paths.StacksDirectoryPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read stack directory: %w", err)
	}
	var stacks []LiveStack
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(paths.StacksDirectoryPath, entry.Name()))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		r, err := parseStackRecord(data)
		if err != nil {
			return nil, fmt.Errorf("read stack %s: %w", entry.Name(), err)
		}
		if routeMutationIsOwnerAlive(r.OwnerPID, r.OwnerStartIdentity) {
			stacks = append(stacks, LiveStack{Name: r.StackName, PID: r.OwnerPID, ManifestPath: r.ManifestPath, StartedAt: r.CreatedAt, ControlPort: r.ControlPort, record: r})
		}
	}
	slices.SortFunc(stacks, func(a, b LiveStack) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.ManifestPath, b.ManifestPath), cmp.Compare(a.PID, b.PID))
	})
	return stacks, nil
}

// SetStackControlPort publishes or withdraws this process's directory backend.
// The stack record remains registered until its services have been cleaned up.
func SetStackControlPort(paths Paths, port int) error {
	return withStackRecordsLock(paths.StacksDirectoryPath, func() error {
		data, err := os.ReadFile(getStackRecordPath(paths.StacksDirectoryPath))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		r, err := parseStackRecord(data)
		if err != nil {
			return err
		}
		r.ControlPort = port
		return writeStackRecord(paths.StacksDirectoryPath, r)
	})
}

func stackDirectorySnippetPath(paths Paths) string {
	return filepath.Join(paths.CaddyDirectoryPath, "stack-directory.caddy")
}

func syncStackDirectorySite(paths Paths, settings ManagedCaddyGlobalSettings) error {
	if err := assertStackDirectoryHostAvailable(paths, settings.StackDirectoryHostname()); err != nil {
		return err
	}
	stacks, err := ReadLiveStacks(paths)
	if err != nil {
		return err
	}
	directory := createManagedCaddyNotFoundSitePaths(paths.CaddyDirectoryPath).DirectoryPath
	document, err := statuspage.StackDirectory(nil, "")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(directory, "stacks.html"), []byte(document), 0o600); err != nil {
		return err
	}
	return writeStackDirectorySite(paths, settings, stacks, directory)
}

func assertStackDirectoryHostAvailable(paths Paths, host string) error {
	claim, err := os.ReadFile(getHostClaimPath(host, paths.RegistrationsDirectoryPath))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil {
		owner, err := parseHostClaim(claim)
		if err != nil {
			return err
		}
		if !isHostClaimStale(owner) {
			return fmt.Errorf("stack directory hostname %s is already claimed by PID %d", host, owner.OwnerPID)
		}
	}
	entries, err := os.ReadDir(paths.RegistrationsDirectoryPath)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(paths.RegistrationsDirectoryPath, entry.Name()))
		if err != nil {
			return err
		}
		var address struct{ Host string }
		if err := json.Unmarshal(data, &address); err != nil {
			return err
		}
		if !strings.EqualFold(address.Host, host) {
			continue
		}
		registration, err := parseManagedRouteRecord(data)
		if err != nil {
			return err
		}
		if routeMutationIsOwnerAlive(registration.OwnerPID, registration.OwnerStartIdentity) {
			return fmt.Errorf("stack directory hostname %s is already routed by PID %d", host, registration.OwnerPID)
		}
	}
	return nil
}

func writeStackDirectorySite(paths Paths, settings ManagedCaddyGlobalSettings, stacks []LiveStack, directory string) error {
	lines := []string{
		"    route {",
		"    header Cache-Control no-store",
		"    header Referrer-Policy no-referrer",
	}
	if !settings.StackDirectoryAllowRemote {
		lines = append(lines,
			"    @remote not remote_ip 127.0.0.0/8 ::1",
			`    respond @remote "The stack directory is available on this machine only." 403`,
		)
	}
	lines = append(lines,
		"    @unsafe not method GET HEAD",
		`    header @unsafe Allow "GET, HEAD"`,
		`    respond @unsafe "Method not allowed" 405`,
		"    @other not path /",
		`    respond @other "Not found" 404`,
	)
	var upstreams []string
	for _, s := range stacks {
		if s.ControlPort > 0 && s.ControlPort <= 65535 {
			upstreams = append(upstreams, fmt.Sprintf("127.0.0.1:%d", s.ControlPort))
		}
	}
	if len(upstreams) > 0 {
		lines = append(lines,
			"    reverse_proxy "+strings.Join(upstreams, " ")+" {",
			"        rewrite /__devhost__/stacks?{query}",
			"        lb_policy first",
			"        lb_try_duration 2s",
			"        fail_duration 5s",
			"        transport http {",
			"            dial_timeout 500ms",
			"        }",
			"    }",
		)
	} else {
		lines = append(lines, "    root * "+filepathQuote(directory), "    rewrite * /stacks.html", "    file_server")
	}
	lines = append(lines,
		"    }",
		"    handle_errors {",
		`        respond "Stack directory unavailable. Start or restart a devhost stack, then refresh this page." 503`,
		"    }",
		"}", "",
	)
	body := strings.Join(lines, "\n")
	document := FormatManagedCaddySiteAddress("https", settings.HTTPSPort, settings.StackDirectoryHostname()) + " {\n    tls internal\n" + body
	if settings.HTTPEnabled {
		document += FormatManagedCaddySiteAddress("http", settings.HTTPPort, settings.StackDirectoryHostname()) + " {\n" + body
	}
	return os.WriteFile(stackDirectorySnippetPath(paths), []byte(document), 0o600)
}

// SyncStackDirectory applies backend changes even for stacks without routes.
func SyncStackDirectory(paths Paths, output RouteCommandOutputWriters) error {
	return withRouteMutationLock(paths, func() error {
		settings, ok, err := ReadAppliedManagedCaddySettings(paths)
		if err != nil || !ok {
			return err
		}
		if err := syncStackDirectorySite(paths, settings); err != nil {
			return err
		}
		if err := writeManagedCaddyfile(paths, settings, runtime.GOOS); err != nil {
			return err
		}
		return reloadManagedCaddy(settings.AdminAddress, paths.RoutesDirectoryPath, output)
	})
}
