package caddy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
	"github.com/shirou/gopsutil/v4/process"
)

// Bump only when a reload cannot apply a runtime policy. Generation 1 clears
// certificates cached by the former unrestricted internal on-demand issuer.
const managedCaddyRestartGeneration = 1

// ManagedCaddyProcess identifies one process, including across PID reuse.
type ManagedCaddyProcess struct {
	PID           int    `json:"pid"`
	StartIdentity string `json:"startIdentity"`
}

type managedCaddyRuntime struct {
	Generation int `json:"restartGeneration"`
	ManagedCaddyProcess
}

func managedCaddyRuntimePath(paths Paths) string {
	return filepath.Join(paths.CaddyDirectoryPath, "runtime.json")
}

func readManagedCaddyRuntime(paths Paths) (managedCaddyRuntime, error) {
	var record managedCaddyRuntime
	text, err := os.ReadFile(managedCaddyRuntimePath(paths))
	if errors.Is(err, fs.ErrNotExist) {
		return record, nil
	}
	if err != nil {
		return record, fmt.Errorf("read managed Caddy runtime: %w", err)
	}
	if err := json.Unmarshal(text, &record); err != nil {
		return record, fmt.Errorf("parse managed Caddy runtime: %w", err)
	}
	if record.Generation < 0 || record.PID < 1 || record.StartIdentity == "" {
		return record, errors.New("invalid managed Caddy runtime record")
	}
	return record, nil
}

func checkManagedCaddyGeneration(paths Paths) error {
	record, err := readManagedCaddyRuntime(paths)
	if err != nil {
		return err
	}
	if record.Generation > managedCaddyRestartGeneration {
		return fmt.Errorf("managed Caddy requires restart generation %d; this devhost supports %d. Upgrade this devhost instance before changing shared Caddy configuration", record.Generation, managedCaddyRestartGeneration)
	}
	return nil
}

func readManagedCaddyProcess(paths Paths) (ManagedCaddyProcess, error) {
	text, err := os.ReadFile(paths.PidFilePath)
	if err != nil {
		return ManagedCaddyProcess{}, fmt.Errorf("read managed Caddy PID: %w", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(text)))
	if err != nil || pid < 1 {
		return ManagedCaddyProcess{}, errors.New("invalid managed Caddy PID")
	}
	identity, err := procid.StartIdentity(pid)
	if err != nil {
		return ManagedCaddyProcess{}, fmt.Errorf("identify managed Caddy process: %w", err)
	}
	return ManagedCaddyProcess{PID: pid, StartIdentity: identity}, nil
}

// Legacy PID files have no start identity. Check their command before an
// automatic stop, so a stale PID cannot authorize stopping an unrelated proxy.
func verifyLegacyManagedCaddyProcess(paths Paths, owner ManagedCaddyProcess) error {
	p, err := process.NewProcess(int32(owner.PID))
	if err != nil {
		return fmt.Errorf("inspect managed Caddy process: %w", err)
	}
	arguments, err := p.CmdlineSlice()
	if err != nil {
		return fmt.Errorf("read managed Caddy command: %w", err)
	}
	if len(arguments) < 2 || arguments[1] != "run" || !hasCaddyArgument(arguments, "--config", paths.CaddyfilePath) || !hasCaddyArgument(arguments, "--pidfile", paths.PidFilePath) {
		return errors.New("cannot verify the running Caddy belongs to this devhost state directory; refusing automatic restart")
	}
	current, err := readManagedCaddyProcess(paths)
	if err != nil {
		return err
	}
	if current != owner {
		return errors.New("managed Caddy process changed while verifying ownership")
	}
	return nil
}

func hasCaddyArgument(arguments []string, flag, value string) bool {
	for index := 2; index+1 < len(arguments); index++ {
		if arguments[index] == flag && arguments[index+1] == value {
			return true
		}
	}
	return false
}

func writeManagedCaddyRuntime(paths Paths, owner ManagedCaddyProcess) error {
	record := managedCaddyRuntime{Generation: managedCaddyRestartGeneration, ManagedCaddyProcess: owner}
	text, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("encode managed Caddy runtime: %w", err)
	}
	path := managedCaddyRuntimePath(paths)
	if err := os.WriteFile(path+".tmp", text, 0o600); err != nil {
		return fmt.Errorf("write managed Caddy runtime: %w", err)
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return fmt.Errorf("record managed Caddy runtime: %w", err)
	}
	return nil
}

// EnsureManagedCaddyRuntime upgrades a running shared proxy when its policy
// requires a fresh process. The lifecycle rechecks under the same lock, so
// simultaneous stack starts cause only one restart.
func EnsureManagedCaddyRuntime(paths Paths, settings ManagedCaddyGlobalSettings, logWriter io.Writer, quiet bool) (restarted bool, err error) {
	var restart bool
	err = withRouteMutationLock(paths, func() error {
		l := managedCaddyLifecycle{paths: paths, readManagedCaddyProcess: func() (ManagedCaddyProcess, error) {
			return readManagedCaddyProcess(paths)
		}}
		var err error
		restart, err = l.needsRestart()
		return err
	})
	if err != nil || !restart {
		return false, err
	}
	_, err = RunManagedCaddyLifecycleCommand(LifecycleStart, logWriter, paths, settings, ManagedCaddyLifecycleDependencies{
		Quiet:                quiet,
		CanPromptForPassword: func() bool { return false },
	})
	return err == nil, err
}
