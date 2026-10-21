package devtools

import (
	"context"
	"testing"
	"testing/synctest"
	"time"
)

func TestHealthPollingStopsWithoutWaitingForTick(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		server := &ControlServer{ctx: ctx, healthPollInterval: defaultHealthPollInterval}
		server.serverWG.Add(1)
		go server.pollHealth()
		synctest.Wait()
		start := time.Now()
		server.mu.Lock()
		server.isStopped = true
		cancel()
		server.mu.Unlock()
		server.serverWG.Wait()
		if elapsed := time.Since(start); elapsed != 0 {
			t.Fatalf("shutdown waited %s for the health polling tick", elapsed)
		}
	})
}
