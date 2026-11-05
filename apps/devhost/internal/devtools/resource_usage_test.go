package devtools

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/gorilla/websocket"
)

func startResourceUsageControlServer(t *testing.T, resourceUsage ResourceUsageOptions) *ControlServer {
	t.Helper()

	controlServer, err := StartControlServer(StartControlServerOptions{
		ComponentEditor:   "vscode",
		FeatureToggles:    FeatureToggles{StatusEnabled: true},
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
		Position:          "bottom-right",
		ProjectRootPath:   t.TempDir(),
		ResourceUsage:     resourceUsage,
		StackName:         "hello-stack",
	})
	if err != nil {
		t.Fatalf("StartControlServer(...) error = %v", err)
	}
	t.Cleanup(func() {
		_ = controlServer.Stop()
	})

	return controlServer
}

func readInjectedResourcesEnabled(t *testing.T, controlServer *ControlServer) bool {
	t.Helper()

	var config struct {
		ResourcesEnabled *bool `json:"resourcesEnabled"`
	}
	if err := json.Unmarshal([]byte(getControlServerText(t, controlServer, injectedConfigPath)), &config); err != nil {
		t.Fatalf("decode injected config: %v", err)
	}
	if config.ResourcesEnabled == nil {
		t.Fatal("injected config has no resourcesEnabled")
	}

	return *config.ResourcesEnabled
}

// A page that connects is shown the readings devhost already holds, then each new one. The interval is short
// because the test waits for the sampler's timer to fire.
func TestControlServerSendsResourceUsageOnAttachAndOnEveryReading(t *testing.T) {
	t.Parallel()

	var cpuPercent atomic.Int64
	cpuPercent.Store(10)
	readCPU, readDisk := make(chan struct{}), make(chan struct{})
	controlServer := startResourceUsageControlServer(t, ResourceUsageOptions{
		Intervals: hostusage.Intervals{CPU: 20 * time.Millisecond, Disk: time.Hour},
		Readers: hostusage.Readers{
			CPU: func(ctx context.Context) (hostusage.CPUUsage, error) {
				select {
				case <-ctx.Done():
					return hostusage.CPUUsage{}, ctx.Err()
				case <-readCPU:
				}
				return hostusage.CPUUsage{Percent: float64(cpuPercent.Load()), Cores: 4}, nil
			},
			Disk: func(ctx context.Context) (hostusage.SpaceUsage, error) {
				select {
				case <-ctx.Done():
					return hostusage.SpaceUsage{}, ctx.Err()
				case <-readDisk:
				}
				return hostusage.SpaceUsage{Percent: 40, UsedBytes: 4, TotalBytes: 10}, nil
			},
		},
	})

	if !readInjectedResourcesEnabled(t, controlServer) {
		t.Fatal("injected config reports resources as off while readouts are polled")
	}

	const first = `{"cpu":{"percent":10,"cores":4},"disk":{"percent":40,"usedBytes":4,"totalBytes":10}}`
	const second = `{"cpu":{"percent":55,"cores":4},"disk":{"percent":40,"usedBytes":4,"totalBytes":10}}`

	socket := mustDialWebsocket(t, websocketURL(controlServer.Port(), resourcesWebsocketPath))
	defer socket.Close()
	_ = socket.SetReadDeadline(time.Now().Add(5 * time.Second))
	// Attach before either reader completes, then release each first reading.
	// All three snapshots are valid; their arrival does not depend on scheduling.
	if message := readWebsocketText(t, socket); message != `{}` {
		t.Fatalf("resource usage before first reads = %s, want {}", message)
	}
	close(readDisk)
	const partial = `{"disk":{"percent":40,"usedBytes":4,"totalBytes":10}}`
	if message := readWebsocketText(t, socket); message != partial {
		t.Fatalf("resource usage after disk read = %s, want %s", message, partial)
	}
	close(readCPU)
	if message := readWebsocketText(t, socket); message != first {
		t.Fatalf("resource usage after both first reads = %s, want %s", message, first)
	}

	// Unchanged readings are not sent again, so the next message is the changed one.
	cpuPercent.Store(55)
	if message := readWebsocketText(t, socket); message != second {
		t.Fatalf("next resource usage = %s, want %s", message, second)
	}

	laterSocket := mustDialWebsocket(t, websocketURL(controlServer.Port(), resourcesWebsocketPath))
	defer laterSocket.Close()
	_ = laterSocket.SetReadDeadline(time.Now().Add(5 * time.Second))
	if message := readWebsocketText(t, laterSocket); message != second {
		t.Fatalf("later client's first resource usage = %s, want %s", message, second)
	}
}

func TestControlServerServesNoResourceUsageWhenEveryReadoutIsOff(t *testing.T) {
	t.Parallel()

	controlServer := startResourceUsageControlServer(t, ResourceUsageOptions{})

	if readInjectedResourcesEnabled(t, controlServer) {
		t.Fatal("injected config reports resources as on while no readout is polled")
	}

	_, response, err := websocket.DefaultDialer.Dial(websocketURL(controlServer.Port(), resourcesWebsocketPath), nil)
	if err == nil {
		t.Fatal("resource usage stream accepted a connection while every readout is off")
	}
	if response == nil || response.StatusCode != http.StatusNotFound {
		t.Fatalf("resource usage stream response = %v, want 404", response)
	}
}

func TestControlServerStopEndsResourceSamplingAndItsStream(t *testing.T) {
	t.Parallel()

	var reads atomic.Int64
	controlServer := startResourceUsageControlServer(t, ResourceUsageOptions{
		Intervals: hostusage.Intervals{Memory: 10 * time.Millisecond},
		Readers: hostusage.Readers{Memory: func(context.Context) (hostusage.SpaceUsage, error) {
			return hostusage.SpaceUsage{Percent: float64(reads.Add(1)), UsedBytes: 1, TotalBytes: 2}, nil
		}},
	})
	socket := mustDialWebsocket(t, websocketURL(controlServer.Port(), resourcesWebsocketPath))
	defer socket.Close()
	_ = socket.SetReadDeadline(time.Now().Add(5 * time.Second))
	readWebsocketText(t, socket)

	if err := controlServer.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}

	// Stop joins the sampler, so no read can follow it.
	readsAtStop := reads.Load()
	for {
		if _, _, err := socket.ReadMessage(); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseGoingAway) {
				t.Fatalf("stream ended with %v, want a going-away close so the page reconnects", err)
			}
			break
		}
	}
	if got := reads.Load(); got != readsAtStop {
		t.Fatalf("memory reads after Stop = %d, want %d", got, readsAtStop)
	}
}
