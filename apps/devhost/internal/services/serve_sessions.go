package services

import (
	"context"
	"fmt"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// ListServeSessions lists the manifest-free sessions, including foreground ones.
func ListServeSessions(environment map[string]string) ([]caddy.LiveStack, error) {
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return nil, err
	}
	stacks, err := caddy.ReadLiveStacks(paths)
	if err != nil {
		return nil, err
	}
	var sessions []caddy.LiveStack
	for _, stack := range stacks {
		if stack.ManifestPath == "" {
			sessions = append(sessions, stack)
		}
	}
	return sessions, nil
}

func findServeSession(name string, environment map[string]string) (caddy.LiveStack, error) {
	sessions, err := ListServeSessions(environment)
	if err != nil {
		return caddy.LiveStack{}, err
	}
	for _, session := range sessions {
		if session.Name == name {
			return session, nil
		}
	}
	return caddy.LiveStack{}, fmt.Errorf("no running serve session named %q; use devhost stack list --sessions", name)
}

func ReadServeInfo(ctx context.Context, name string, environment map[string]string) (StackInfo, error) {
	stack, err := findServeSession(name, environment)
	if err != nil {
		return StackInfo{}, err
	}
	return readLiveStackInfo(ctx, stack)
}

func StopServeSession(name string, environment map[string]string) error {
	stack, err := findServeSession(name, environment)
	if err != nil {
		return err
	}
	paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(environment)
	if err != nil {
		return err
	}
	if err := stack.Signal(paths, syscall.SIGTERM); err != nil {
		return err
	}
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(detachedPollInterval)
	defer ticker.Stop()
	for stack.Alive() {
		select {
		case <-timer.C:
			return fmt.Errorf("serve session %s is still stopping (PID %d)", name, stack.PID)
		case <-ticker.C:
		}
	}
	return nil
}
