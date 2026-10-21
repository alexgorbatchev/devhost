package caddy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
	"github.com/shirou/gopsutil/v4/process"
)

// ZombieCleanup deduplicates kill attempts across one startup or reload's claims.
// Its zero value is ready to use. Each claim pass must use a fresh instance.
type ZombieCleanup struct {
	mu        sync.Mutex
	attempted map[zombieOwner]error
}

type zombieOwner struct {
	pid           int
	startIdentity string
}

var routeMutationKillProcess = func(pid int) error {
	owner, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	err = owner.Kill()
	return errors.Join(err, owner.Release())
}

var routeMutationWaitZombieExit = waitZombieExit

func (c *ZombieCleanup) kill(pid int, startIdentity, claim string, logs io.Writer) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	owner := zombieOwner{pid: pid, startIdentity: startIdentity}
	if err, ok := c.attempted[owner]; ok {
		return err
	}
	if c.attempted == nil {
		c.attempted = make(map[zombieOwner]error)
	}
	err := stopZombie(owner, claim, logs)
	c.attempted[owner] = err
	return err
}

func stopZombie(owner zombieOwner, claim string, logs io.Writer) error {
	if logs != nil {
		cliout.Log(logs, "devhost", fmt.Sprintf("Stopping zombie PID %d claiming %s...", owner.pid, claim))
	}
	if err := routeMutationKillProcess(owner.pid); err != nil && !errors.Is(err, os.ErrProcessDone) && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("stop zombie PID %d claiming %s: %w", owner.pid, claim, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := routeMutationWaitZombieExit(ctx, owner); err != nil {
		return fmt.Errorf("confirm exit of zombie PID %d claiming %s: %w", owner.pid, claim, err)
	}
	if logs != nil {
		cliout.Log(logs, "devhost", fmt.Sprintf("Stopped zombie PID %d claiming %s.", owner.pid, claim))
	}
	return nil
}

// The owner may belong to another supervisor, so os.Process.Wait cannot reap it.
// Observe its identity and OS state instead; an unreaped zombie has exited too.
func waitZombieExit(ctx context.Context, owner zombieOwner) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		exited, err := zombieExited(ctx, owner)
		if err != nil || exited {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func zombieExited(ctx context.Context, owner zombieOwner) (bool, error) {
	if owner.startIdentity != "" {
		identity, err := procid.StartIdentity(owner.pid)
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ESRCH) {
			return true, nil
		}
		if err != nil {
			return false, err
		}
		if identity != owner.startIdentity {
			return true, nil
		}
	}
	ownerProcess, err := process.NewProcessWithContext(ctx, int32(owner.pid))
	if errors.Is(err, process.ErrorProcessNotRunning) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	statuses, err := ownerProcess.StatusWithContext(ctx)
	if err != nil {
		// The owner can exit between the existence check and the status read.
		exists, probeErr := process.PidExistsWithContext(ctx, int32(owner.pid))
		if probeErr == nil && !exists {
			return true, nil
		}
		return false, errors.Join(err, probeErr)
	}
	return slices.Contains(statuses, process.Zombie), nil
}
