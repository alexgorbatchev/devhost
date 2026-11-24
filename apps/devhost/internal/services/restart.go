package services

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/unix"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

const restartPollInterval = 100 * time.Millisecond
const restartRegistrationTimeout = 30 * time.Second

type RestartStacksOptions struct {
	ManifestPath string
	All          bool
}

type stackLaunch struct {
	stack            caddy.LiveStack
	args             []string
	directory        string
	environment      []string
	log              *os.File
	directoryMissing bool
}

// RestartStacks replaces running supervisors with this executable. Launch
// environments stay in memory, rather than being persisted with diagnostics.
func RestartStacks(options RestartStacksOptions, environment map[string]string, stdout io.Writer) (err error) {
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(paths.StateDirectoryPath, 0o700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(paths.StateDirectoryPath, "restart.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, lock.Close()) }()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return fmt.Errorf("another stack restart is in progress: %w", err)
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err := unix.Access(executable, unix.X_OK); err != nil {
		return fmt.Errorf("replacement executable unavailable; no stacks were stopped: %w", err)
	}
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		return err
	}
	if !options.All {
		manifest := caddy.ManifestIdentity(options.ManifestPath)
		stacks = slices.DeleteFunc(stacks, func(s caddy.LiveStack) bool { return caddy.ManifestIdentity(s.ManifestPath) != manifest })
	}
	if len(stacks) == 0 {
		return cliout.WriteLog(stdout, "devhost", "No running stacks to restart.")
	}
	launches, err := captureStackLaunches(stacks, paths, options.All)
	if err != nil {
		return err
	}
	defer func() {
		for _, launch := range launches {
			if launch.log != nil {
				err = errors.Join(err, launch.log.Close())
			}
		}
	}()
	var failures []error
	for _, launch := range launches {
		if launch.directoryMissing {
			if err := stopStackForRestart(launch.stack, paths); err != nil {
				failures = append(failures, fmt.Errorf("stop %s (PID %d) with missing launch directory: %w", launch.stack.Name, launch.stack.PID, err))
			} else {
				cliout.Log(stdout, "devhost", fmt.Sprintf("Stopped %s (PID %d) because its launch directory was removed.", launch.stack.Name, launch.stack.PID))
			}
			continue
		}
		cliout.Log(stdout, "devhost", fmt.Sprintf("Restarting %s (PID %d); log: %s", launch.stack.Name, launch.stack.PID, launch.log.Name()))
		if err := replaceStack(launch, paths, executable, stdout); err != nil {
			failures = append(failures, fmt.Errorf("restart %s (PID %d), log %s: %w", launch.stack.Name, launch.stack.PID, launch.log.Name(), err))
		}
	}
	return errors.Join(failures...)
}

func captureStackLaunches(stacks []caddy.LiveStack, paths caddy.Paths, stopMissingDirectory bool) (launches []stackLaunch, err error) {
	var directory string
	defer func() {
		if err != nil && directory != "" {
			for _, launch := range launches {
				if launch.log != nil {
					err = errors.Join(err, launch.log.Close())
				}
			}
			err = errors.Join(err, os.RemoveAll(directory))
		}
	}()
	for _, stack := range stacks {
		launch, captureErr := captureStackLaunch(stack, stopMissingDirectory)
		if captureErr != nil {
			return launches, fmt.Errorf("capture %s (PID %d); no stacks were stopped: %w", stack.Name, stack.PID, captureErr)
		}
		if !launch.directoryMissing {
			if directory == "" {
				directory, err = os.MkdirTemp(paths.StateDirectoryPath, "restart-")
				if err != nil {
					return launches, err
				}
			}
			launch.log, err = os.OpenFile(filepath.Join(directory, fmt.Sprintf("%d.log", stack.PID)), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return launches, err
			}
		}
		launches = append(launches, launch)
	}
	return launches, nil
}

func captureStackLaunch(stack caddy.LiveStack, stopMissingDirectory bool) (stackLaunch, error) {
	p, err := process.NewProcess(int32(stack.PID))
	if err != nil {
		return stackLaunch{}, err
	}
	// Restarting an ancestor would kill the command before it can relaunch it.
	for ancestor := int32(os.Getpid()); ancestor > 1; {
		if ancestor == p.Pid {
			return stackLaunch{}, fmt.Errorf("cannot restart an ancestor of this command; run it from a separate terminal")
		}
		parent, err := process.NewProcess(ancestor)
		if err != nil {
			return stackLaunch{}, err
		}
		ancestor, err = parent.Ppid()
		if err != nil {
			return stackLaunch{}, err
		}
	}
	args, err := p.CmdlineSlice()
	if err != nil {
		return stackLaunch{}, err
	}
	if len(args) < 2 || (args[1] != "start" && args[1] != "serve") {
		return stackLaunch{}, fmt.Errorf("expected a devhost start or serve process")
	}
	directory, err := p.Cwd()
	if err != nil {
		return stackLaunch{}, err
	}
	info, err := os.Stat(directory)
	if err != nil {
		if stopMissingDirectory && errors.Is(err, os.ErrNotExist) {
			if !stack.Alive() {
				return stackLaunch{}, fmt.Errorf("stack process changed during capture")
			}
			return stackLaunch{stack: stack, directoryMissing: true}, nil
		}
		return stackLaunch{}, err
	}
	if !info.IsDir() {
		return stackLaunch{}, fmt.Errorf("launch working directory is not a directory")
	}
	environment, err := p.Environ()
	if err != nil {
		return stackLaunch{}, err
	}
	if len(environment) == 0 {
		return stackLaunch{}, fmt.Errorf("the operating system did not provide the launch environment")
	}
	if !stack.Alive() {
		return stackLaunch{}, fmt.Errorf("stack process changed during capture")
	}
	launchArgs := preserveLaunchMode(args[1:], stack.Remote)
	if stack.ManifestPath == "" {
		launchArgs = preserveServeSession(launchArgs, stack.Name)
	}
	return stackLaunch{stack: stack, args: launchArgs, directory: directory, environment: environment}, nil
}

func preserveServeSession(args []string, name string) []string {
	index := slices.Index(args, "--")
	if index < 0 {
		index = len(args)
	}
	for _, arg := range args[:index] {
		if arg == "--session-id" || strings.HasPrefix(arg, "--session-id=") || arg == "--domain" || strings.HasPrefix(arg, "--domain=") || strings.HasPrefix(arg, "-d") {
			return args
		}
	}
	return slices.Insert(slices.Clone(args), 1, "--session-id", name)
}

// replaceLaunchLog drops the private launch variables from a captured
// environment, which the OS reports as the supervisor started with them. A
// supervisor that recorded a log has its replacement record the new one, but
// never in strict detached startup: no command waits for the replacement's
// readiness, so a service that fails must stay recoverable.
func replaceLaunchLog(environment []string, logPath string) []string {
	recorded := false
	environment = slices.DeleteFunc(slices.Clone(environment), func(entry string) bool {
		name, _, _ := strings.Cut(entry, "=")
		if slices.Contains(launchEnvironment, name) {
			recorded = true
			return true
		}
		return false
	})
	if recorded {
		environment = append(environment, StackLogEnvironment+"="+logPath)
	}
	return environment
}

func stopStackForRestart(stack caddy.LiveStack, paths caddy.Paths) error {
	if err := stack.Signal(paths, syscall.SIGTERM); err != nil {
		return err
	}
	deadline := time.Now().Add(stopGracePeriod)
	for stack.Alive() && processExists(stack.PID) {
		if time.Now().After(deadline) {
			return fmt.Errorf("stack is still stopping after %s", stopGracePeriod)
		}
		time.Sleep(restartPollInterval)
	}
	return nil
}

func replaceStack(launch stackLaunch, paths caddy.Paths, executable string, stdout io.Writer) error {
	if err := stopStackForRestart(launch.stack, paths); err != nil {
		return err
	}
	input, err := os.Open(os.DevNull)
	if err != nil {
		return err
	}
	defer input.Close() // Closing the parent's copy leaves the child's input intact.
	args := append([]string{executable}, launch.args...)
	child, err := os.StartProcess(executable, args, &os.ProcAttr{
		Dir: launch.directory, Env: replaceLaunchLog(launch.environment, launch.log.Name()),
		Files: []*os.File{input, launch.log, launch.log},
		Sys:   &syscall.SysProcAttr{Setsid: true},
	})
	if err != nil {
		return err
	}
	defer child.Release() // A detached supervisor outlives the restart command.
	deadline := time.Now().Add(restartRegistrationTimeout)
	for {
		stacks, err := caddy.ReadLiveStacks(paths)
		if err != nil {
			return err
		}
		for _, stack := range stacks {
			if stack.PID == child.Pid && stack.ControlPort > 0 {
				return cliout.WriteLog(stdout, "devhost", fmt.Sprintf("Restarted %s (PID %d); services may still be starting.", stack.Name, stack.PID))
			}
		}
		if !processExists(child.Pid) {
			_, waitErr := child.Wait()
			return fmt.Errorf("replacement exited before its control server registered: %v", waitErr)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("replacement PID %d has not registered after %s; it remains running, inspect its log", child.Pid, restartRegistrationTimeout)
		}
		time.Sleep(restartPollInterval)
	}
}

// preserveLaunchMode freezes the recorded mode even if machine enrollment changed.
func preserveLaunchMode(args []string, remoteMode bool) []string {
	if len(args) == 0 || args[0] != "start" {
		return slices.Clone(args)
	}
	index := slices.Index(args, "--")
	if index < 0 {
		index = len(args)
	}
	flags := []string{fmt.Sprintf("--remote=%t", remoteMode), fmt.Sprintf("--local=%t", !remoteMode)}
	start := index
	if index >= 2 && strings.HasPrefix(args[index-2], "--remote=") && strings.HasPrefix(args[index-1], "--local=") {
		start -= 2
	}
	return slices.Replace(slices.Clone(args), start, index, flags...)
}
