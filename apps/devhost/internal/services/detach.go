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

// DetachedLogEnvironment is private launch metadata. The supervisor removes it
// from service environments; stack restart replaces it with its new log path.
const DetachedLogEnvironment = "DEVHOST_INTERNAL_DETACHED_LOG"
const detachedPollInterval = 50 * time.Millisecond

type detachedProcess struct {
	command *exec.Cmd
	done    chan struct{}
	err     error
}

type DetachedStartOptions struct {
	Manifest    ResolvedManifest
	Arguments   []string
	Directory   string
	Environment map[string]string
	Stdout      io.Writer
	Stderr      io.Writer
}

// StartDetachedStack serializes callers for one canonical manifest. The child
// owns normal stack cleanup; its existing ownership record carries readiness.
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
	lock, err := os.OpenFile(filepath.Join(directory, stem+".lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close() // Closing releases this caller's lock without unlink races.
	ctx, cancel := context.WithTimeout(ctx, detachedStartupTimeout(options.Manifest))
	defer cancel()
	if err := lockDetachedStart(ctx, lock); err != nil {
		return err
	}
	if existing, err := findDetachedStack(paths, canonical); err != nil {
		return err
	} else if existing != nil {
		return reportDetachedStack(options.Stdout, *existing, true)
	}
	log, err := os.OpenFile(filepath.Join(directory, stem+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
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
	child.Env = createChildEnvironment(options.Environment, map[string]string{DetachedLogEnvironment: log.Name()})
	// A nil Stdin is /dev/null. Direct files prevent exec.Cmd from leaving a
	// forwarding goroutine attached to the calling terminal.
	child.Stdout, child.Stderr = log, log
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := child.Start(); err != nil {
		return err
	}
	process := &detachedProcess{command: child, done: make(chan struct{})}
	go func() {
		process.err = child.Wait()
		close(process.done)
	}()
	stack, err := process.waitReady(ctx, paths, canonical)
	if err == nil {
		err = reportDetachedStack(options.Stdout, stack, false)
		if err == nil {
			return nil
		}
	}
	// Signal only this child, never whichever process now owns the manifest.
	// Wait for the supervisor's deferred cleanup before returning a failure.
	if signalErr := child.Process.Signal(syscall.SIGTERM); signalErr != nil && !errors.Is(signalErr, os.ErrProcessDone) {
		err = errors.Join(err, signalErr)
	}
	<-process.done
	writeDetachedLogTail(options.Stderr, log.Name(), info.Size())
	return fmt.Errorf("detached startup failed (log: %s): %w", log.Name(), err)
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

func lockDetachedStart(ctx context.Context, file *os.File) error {
	ticker := time.NewTicker(detachedPollInterval)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("waiting for detached startup lock: %w", err)
		}
		err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EINTR) {
			return err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("waiting for detached startup lock: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func findDetachedStack(paths caddy.Paths, canonical string) (*caddy.LiveStack, error) {
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		return nil, err
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

func (p *detachedProcess) waitReady(ctx context.Context, paths caddy.Paths, canonical string) (caddy.LiveStack, error) {
	ticker := time.NewTicker(detachedPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-p.done:
			if p.err == nil {
				return caddy.LiveStack{}, fmt.Errorf("supervisor exited before becoming ready")
			}
			return caddy.LiveStack{}, p.err
		case <-ctx.Done():
			return caddy.LiveStack{}, ctx.Err()
		case <-ticker.C:
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
