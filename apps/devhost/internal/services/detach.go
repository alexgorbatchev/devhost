package services

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

// DetachedLogEnvironment and StackLogEnvironment are private launch metadata,
// which TakeLaunchMetadata removes before the stack starts anything. devhost
// start --detach names its supervisor's log in DetachedLogEnvironment, which
// also makes startup strict. stack restart names a replacement's log in
// StackLogEnvironment: nothing waits for a replacement's readiness, so it
// starts like a foreground stack and keeps failed services recoverable.
const DetachedLogEnvironment = "DEVHOST_INTERNAL_DETACHED_LOG"
const StackLogEnvironment = "DEVHOST_INTERNAL_STACK_LOG"
const detachedPollInterval = 50 * time.Millisecond

var launchEnvironment = []string{DetachedLogEnvironment, StackLogEnvironment}

// LaunchMetadata is what devhost tells a supervisor it launches.
type LaunchMetadata struct {
	// LogPath names the file the supervisor's output goes to, which the stack
	// record reports.
	LogPath string
	// Detached is set for the supervisor of devhost start --detach. Its startup
	// ends the stack when a service fails to start or pass health, and publishes
	// readiness only after health and routing succeed.
	Detached bool
}

// TakeLaunchMetadata reads devhost's private launch variables and removes them
// from environment and from this process's environment, so neither the
// services nor the caddy and git commands the stack runs inherit them.
func TakeLaunchMetadata(environment map[string]string) LaunchMetadata {
	metadata := LaunchMetadata{LogPath: environment[StackLogEnvironment]}
	if path := environment[DetachedLogEnvironment]; path != "" {
		metadata = LaunchMetadata{LogPath: path, Detached: true}
	}
	for _, name := range launchEnvironment {
		delete(environment, name)
		_ = os.Unsetenv(name) // Unsetenv fails only for an invalid name.
	}
	return metadata
}

type detachedProcess struct {
	command *exec.Cmd
	done    chan struct{}
}

type DetachedStartOptions struct {
	Manifest    ResolvedManifest
	Arguments   []string
	Directory   string
	Environment map[string]string
	// Signals delivers the signals that cancel the start. The first one stops
	// the supervisor; a later one ends the wait for its cleanup, which the
	// supervisor then finishes on its own.
	Signals <-chan os.Signal
	Stdout  io.Writer
	Stderr  io.Writer
	// cleanupTimeout bounds the wait for a failed supervisor's cleanup. Zero is
	// detachedCleanupTimeout of the manifest.
	cleanupTimeout time.Duration
}

// StartDetachedStack serializes callers for one canonical manifest. The child
// owns normal stack cleanup; its existing ownership record carries readiness.
// Every failure after the log path is known names its cause and that log.
func StartDetachedStack(ctx context.Context, options DetachedStartOptions) error {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return fmt.Errorf("--detach is supported only on Linux and macOS")
	}
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(options.Environment)
	if err != nil {
		return err
	}
	canonical, err := filepath.EvalSymlinks(options.Manifest.ManifestPath)
	if err != nil {
		return err
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return err
	}
	directory := filepath.Join(paths.StateDirectoryPath, "logs")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	stem := fmt.Sprintf("stack-%x", sha256.Sum256([]byte(canonical)))
	logPath := filepath.Join(directory, stem+".log")
	lock, err := os.OpenFile(filepath.Join(directory, stem+".lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close() // Closing releases this caller's lock without unlink races.
	limit := detachedStartupTimeout(options.Manifest)
	if deadline, ok := ctx.Deadline(); ok {
		limit = min(limit, time.Until(deadline))
	}
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	attempt := detachedAttempt{ctx: ctx, signals: options.Signals, limit: limit}
	if err := attempt.lock(lock); err != nil {
		return detachedFailure(err, logPath, "")
	}
	if existing, err := findDetachedStack(paths, canonical); err != nil {
		return err
	} else if existing != nil {
		return reportDetachedStack(options.Stdout, *existing, true)
	}
	failurePath := detachedFailurePath(logPath)
	if err := removeDetachedFailure(failurePath); err != nil {
		return err
	}
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer log.Close() // The child retains its own append-only descriptors.
	info, err := log.Stat()
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	child := exec.Command(executable, options.Arguments...)
	child.Dir = options.Directory
	child.Env = createChildEnvironment(options.Environment, map[string]string{DetachedLogEnvironment: logPath})
	// A nil Stdin is /dev/null. Direct files prevent exec.Cmd from leaving a
	// forwarding goroutine attached to the calling terminal.
	child.Stdout, child.Stderr = log, log
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		return detachedFailure(fmt.Errorf("the stack supervisor could not be launched: %w", err), logPath, "")
	}
	process := &detachedProcess{command: child, done: make(chan struct{})}
	go func() {
		_ = child.Wait() // ProcessState describes the exit.
		close(process.done)
	}()
	stack, err := attempt.waitReady(process, paths, canonical, failurePath)
	if err == nil {
		err = reportDetachedStack(options.Stdout, stack, false)
		if err == nil {
			return nil
		}
		err = fmt.Errorf("reporting the started stack failed: %w", err)
	}
	return finishDetachedFailure(err, detachedFailureOptions{
		process:        process,
		signals:        options.Signals,
		cleanupTimeout: options.cleanupTimeout,
		manifest:       options.Manifest,
		logPath:        logPath,
		logOffset:      info.Size(),
		stderr:         options.Stderr,
	})
}

type detachedFailureOptions struct {
	process        *detachedProcess
	signals        <-chan os.Signal
	cleanupTimeout time.Duration
	manifest       ResolvedManifest
	logPath        string
	logOffset      int64
	stderr         io.Writer
}

// finishDetachedFailure stops the supervisor this caller launched, waits a
// bounded time for its own cleanup, prints its log tail, and returns the line
// the command ends with.
func finishDetachedFailure(cause error, options detachedFailureOptions) error {
	failurePath := detachedFailurePath(options.logPath)
	child := options.process.command.Process
	var notReady *serviceNotReadyError
	if !errors.As(cause, &notReady) {
		// Signal only this child, never whichever process now owns the manifest.
		// A supervisor that recorded a failure is already stopping itself.
		if err := child.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
			cause = fmt.Errorf("%w; signaling the stack failed: %v", cause, err)
		}
	}
	// The supervisor's cleanup stops its services and removes its routes and
	// claims; it is never killed, so nothing it started is left behind.
	cleanupTimeout := options.cleanupTimeout
	if cleanupTimeout <= 0 {
		cleanupTimeout = detachedCleanupTimeout(options.manifest)
	}
	stopped := options.process.waitStopped(options.signals, cleanupTimeout)
	if failure := readDetachedFailure(failurePath); failure != nil && notReady == nil {
		// A service failed before the supervisor heard of the timeout or signal.
		cause = failure
	}
	// A supervisor still failing can write its record after this; the next start
	// removes it before launching, and fails if it cannot.
	_ = removeDetachedFailure(failurePath)
	writeDetachedLogTail(options.stderr, options.logPath, options.logOffset)
	if !stopped {
		cause = fmt.Errorf("%w; the stack (PID %d) is still stopping", cause, child.Pid)
		return detachedFailure(cause, options.logPath, "Run \"devhost stack list\" to see when it has stopped.")
	}
	return detachedFailure(cause, options.logPath, "")
}

func detachedStartupTimeout(manifest ResolvedManifest) time.Duration {
	// Setup and route registration get two minutes in addition to every selected
	// service's health budget, including automatic-port retries and their cleanup.
	timeout := 2 * time.Minute
	for _, service := range manifest.Services {
		attempts := 1
		if service.PortSource == "auto" {
			attempts += MaximumAutoPortRetryCount
		}
		timeout += time.Duration(attempts) * (time.Duration(service.Health.Timeout)*time.Millisecond + shutdownGracePeriod)
	}
	return timeout
}

// detachedCleanupTimeout bounds the wait for a failed supervisor's cleanup. Each
// service gets a grace period to stop and another after SIGKILL; routes, claims,
// and daemon stop commands get a minute beside them.
func detachedCleanupTimeout(manifest ResolvedManifest) time.Duration {
	return time.Minute + time.Duration(len(manifest.Services))*2*shutdownGracePeriod
}

// detachedAttempt is one caller's wait for a detached start. Its context
// carries the startup deadline, limit after the start; signals are the
// caller's.
type detachedAttempt struct {
	ctx     context.Context
	signals <-chan os.Signal
	limit   time.Duration
}

// ended says why the attempt's context is done: its deadline passed before
// what was awaited happened, or the caller canceled it.
func (a detachedAttempt) ended(awaited string) error {
	if errors.Is(a.ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("%s within %s", awaited, a.limit.Round(time.Millisecond))
	}
	return errors.New("the start was canceled before the stack was ready")
}

func (a detachedAttempt) lock(file *os.File) error {
	ticker := time.NewTicker(detachedPollInterval)
	defer ticker.Stop()
	for {
		if a.ctx.Err() != nil {
			return a.ended("another start of this manifest did not finish")
		}
		err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EINTR) {
			return fmt.Errorf("locking the detached start failed: %w", err)
		}
		select {
		case <-a.ctx.Done():
		case received := <-a.signals:
			return fmt.Errorf("received %s while another start of this manifest was running", describeShutdownSignal(received))
		case <-ticker.C:
		}
	}
}

func findDetachedStack(paths caddy.Paths, canonical string) (*caddy.LiveStack, error) {
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		return nil, fmt.Errorf("reading the running stacks failed: %w", err)
	}
	for _, stack := range stacks {
		path, err := filepath.EvalSymlinks(stack.ManifestPath)
		if err != nil {
			path = filepath.Clean(stack.ManifestPath)
		}
		if path == canonical {
			return &stack, nil
		}
	}
	return nil, nil
}

// waitReady returns the supervisor's stack once it is ready, or why it is not:
// a service it recorded, its exit, the deadline, or a signal.
func (a detachedAttempt) waitReady(p *detachedProcess, paths caddy.Paths, canonical, failurePath string) (caddy.LiveStack, error) {
	ticker := time.NewTicker(detachedPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.done:
			return caddy.LiveStack{}, p.exitCause(failurePath)
		case <-a.ctx.Done():
			return caddy.LiveStack{}, a.ended("the stack was not ready")
		case received := <-a.signals:
			return caddy.LiveStack{}, fmt.Errorf("received %s before the stack was ready", describeShutdownSignal(received))
		case <-ticker.C:
			if failure := readDetachedFailure(failurePath); failure != nil {
				return caddy.LiveStack{}, failure
			}
			stack, err := findDetachedStack(paths, canonical)
			if err != nil {
				return caddy.LiveStack{}, err
			}
			if stack != nil && stack.PID == p.command.Process.Pid && stack.Ready {
				return *stack, nil
			}
		}
	}
}

// exitCause describes a supervisor that exited before it was ready.
func (p *detachedProcess) exitCause(failurePath string) error {
	if failure := readDetachedFailure(failurePath); failure != nil {
		return failure
	}
	return fmt.Errorf("the stack exited before it was ready (exit code %d)", readProcessExitCode(p.command.ProcessState))
}

// waitStopped waits for a failed supervisor's own cleanup. The timeout or a
// signal ends the wait without stopping the supervisor, so it still removes
// everything it started; waitStopped reports whether it exited.
func (p *detachedProcess) waitStopped(signals <-chan os.Signal, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-p.done:
		return true
	case <-signals:
	case <-timer.C:
	}
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

func reportDetachedStack(writer io.Writer, stack caddy.LiveStack, existing bool) error {
	state := "Started"
	if existing {
		state = "Already running"
	}
	if err := cliout.WriteLog(writer, "devhost", fmt.Sprintf("%s %s (PID %d).", state, stack.Name, stack.PID)); err != nil {
		return err
	}
	if !existing {
		for _, url := range stack.URLs {
			if err := cliout.WriteLog(writer, "devhost", url); err != nil {
				return err
			}
		}
	}
	if stack.LogPath != "" {
		return cliout.WriteLog(writer, "devhost", "Log: "+stack.LogPath)
	}
	return nil
}

func writeDetachedLogTail(writer io.Writer, path string, offset int64) {
	file, err := os.Open(path)
	if err != nil {
		cliout.Log(writer, "devhost", "Cannot read startup log: "+err.Error())
		return
	}
	defer file.Close() // Read-only diagnostic file.
	info, err := file.Stat()
	if err != nil {
		return
	}
	offset = max(offset, info.Size()-64*1024)
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, 64*1024))
	if err != nil {
		return
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) > 30 {
		lines = lines[len(lines)-30:]
	}
	cliout.Log(writer, "devhost", "Startup log tail:")
	for _, line := range lines {
		_ = cliout.WriteChildLine(writer, line)
	}
}
