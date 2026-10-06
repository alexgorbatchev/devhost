package services

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaitForServiceHealth(t *testing.T) {
	t.Parallel()

	t.Run("accepts process health checks when child is still running", func(t *testing.T) {
		t.Parallel()

		err := WaitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "process", Interval: 200, Timeout: 30000, Retries: 0},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "worker",
		})
		if err != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", err)
		}
	})

	t.Run("waits for a tcp port to accept connections", func(t *testing.T) {
		t.Parallel()

		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("net.Listen(...) error = %v", err)
		}
		defer listener.Close()

		acceptDone := make(chan struct{})
		go func() {
			defer close(acceptDone)
			connection, acceptError := listener.Accept()
			if acceptError == nil {
				_ = connection.Close()
			}
		}()

		port := listener.Addr().(*net.TCPAddr).Port
		host := "127.0.0.1"
		err = WaitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Host: &host, Interval: 200, Port: &port, Retries: 0, Timeout: 30000},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		})
		if err != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", err)
		}

		<-acceptDone
	})

	t.Run("waits for an http health endpoint", func(t *testing.T) {
		t.Parallel()

		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		err := WaitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "http", Interval: 200, Retries: 0, Timeout: 30000, URL: &server.URL},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "api",
		})
		if err != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", err)
		}
	})

	t.Run("fails fast when the child exits before passing its health check", func(t *testing.T) {
		t.Parallel()

		exitCode := 2
		host := "127.0.0.1"
		port := 65534
		err := waitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Host: &host, Interval: 1, Port: &port, Retries: 0, Timeout: 100},
			ReadExitCode: func() *int {
				return &exitCode
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort:    func(ctx context.Context, host string, port int, timeout time.Duration) bool { return false },
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
			now:                 time.Now,
			sleep:               func(context.Context, time.Duration) error { return nil },
		})
		wantError := "Service web exited before passing its health check with code 2."
		if err == nil || err.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", err, wantError)
		}
	})

	t.Run("retries zero keeps polling until timeout", func(t *testing.T) {
		t.Parallel()

		checks := 0
		currentTime := time.Unix(0, 0)
		err := waitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Interval: 10, Retries: 0, Timeout: 30, Host: stringPointer("127.0.0.1"), Port: intPointer(3000)},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool {
				checks++
				return false
			},
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
			now: func() time.Time {
				return currentTime
			},
			sleep: func(_ context.Context, duration time.Duration) error {
				currentTime = currentTime.Add(duration)
				return nil
			},
		})
		wantError := "Service web did not pass its health check within 30ms."
		if err == nil || err.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", err, wantError)
		}
		if checks != 3 {
			t.Fatalf("WaitForServiceHealth(...) checks = %d, want 3", checks)
		}
	})

	t.Run("positive retries fail early after consecutive failures", func(t *testing.T) {
		t.Parallel()

		checks := 0
		currentTime := time.Unix(0, 0)
		err := waitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Interval: 10, Retries: 2, Timeout: 1000, Host: stringPointer("127.0.0.1"), Port: intPointer(3000)},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool {
				checks++
				return false
			},
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
			now: func() time.Time {
				return currentTime
			},
			sleep: func(_ context.Context, duration time.Duration) error {
				currentTime = currentTime.Add(duration)
				return nil
			},
		})
		wantError := "Service web failed its health check 3 consecutive times."
		if err == nil || err.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", err, wantError)
		}
		if checks != 3 {
			t.Fatalf("WaitForServiceHealth(...) checks = %d, want 3", checks)
		}
	})

	t.Run("triggers OnProgress callback during polling", func(t *testing.T) {
		t.Parallel()

		progressCalls := 0
		var elapsedPassed time.Duration
		var attemptsPassed int

		currentTime := time.Unix(0, 0)
		err := waitForServiceHealth(context.Background(), WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Interval: 10, Retries: 0, Timeout: 30, Host: stringPointer("127.0.0.1"), Port: intPointer(3000)},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
			OnProgress: func(attempts int, elapsed time.Duration) {
				progressCalls++
				attemptsPassed = attempts
				elapsedPassed = elapsed
			},
		}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool {
				return false
			},
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
			now: func() time.Time {
				return currentTime
			},
			sleep: func(_ context.Context, duration time.Duration) error {
				currentTime = currentTime.Add(duration)
				return nil
			},
		})

		wantError := "Service web did not pass its health check within 30ms."
		if err == nil || err.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", err, wantError)
		}
		if progressCalls != 3 {
			t.Fatalf("OnProgress called %d times, want 3", progressCalls)
		}
		if attemptsPassed != 3 {
			t.Fatalf("OnProgress attempts = %d, want 3", attemptsPassed)
		}
		if elapsedPassed != 20*time.Millisecond {
			t.Fatalf("OnProgress elapsed = %v, want 20ms", elapsedPassed)
		}
	})
}

func TestWaitForServiceHealthCancellationInterruptsLongInterval(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	started := time.Now()
	err := WaitForServiceHealth(ctx, WaitForServiceHealthOptions{
		Health:      ResolvedHealthConfig{Kind: "http", Interval: 2000, Timeout: 5000, URL: &server.URL},
		ServiceName: "web",
		OnProgress:  func(int, time.Duration) { cancel() },
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("health polling did not preserve cancellation: %v", err)
	}
	if elapsed := time.Since(started); elapsed >= time.Second {
		t.Fatalf("cancellation waited for the polling interval: %s", elapsed)
	}
}

func TestWaitForServiceHealthCancellationInterruptsInFlightHTTPProbe(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
	}))
	defer server.Close()
	result := make(chan error, 1)
	go func() {
		result <- WaitForServiceHealth(ctx, WaitForServiceHealthOptions{
			Health:      ResolvedHealthConfig{Kind: HealthKindHTTP, Interval: 3000, Timeout: 5000, URL: &server.URL},
			ServiceName: "web",
		})
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("health request did not reach the server")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("health polling did not preserve cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown cancellation did not interrupt the in-flight health request")
	}
}

func TestCheckServiceHealth(t *testing.T) {
	t.Parallel()

	t.Run("process health succeeds immediately", func(t *testing.T) {
		t.Parallel()

		if !CheckServiceHealth(ResolvedHealthConfig{Kind: "process"}) {
			t.Fatal("CheckServiceHealth(...) = false, want true")
		}
	})

	t.Run("tcp health resolves loopback wildcard through proxy host normalization", func(t *testing.T) {
		t.Parallel()

		host := "0.0.0.0"
		port := 3000
		calls := 0
		result := checkServiceHealth(context.Background(), ResolvedHealthConfig{Kind: "tcp", Host: &host, Port: &port}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool {
				calls++
				return host == "127.0.0.1" && port == 3000
			},
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
		})
		if !result {
			t.Fatal("checkServiceHealth(...) = false, want true")
		}
		if calls != 1 {
			t.Fatalf("checkServiceHealth(...) tcp calls = %d, want 1", calls)
		}
	})

	t.Run("http health returns endpoint readiness", func(t *testing.T) {
		t.Parallel()

		url := "http://127.0.0.1/healthz"
		result := checkServiceHealth(context.Background(), ResolvedHealthConfig{Kind: "http", URL: &url}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool { return false },
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool {
				return true
			},
		})
		if !result {
			t.Fatal("checkServiceHealth(...) = false, want true")
		}
	})

	t.Run("unsupported proxy hosts return unhealthy instead of panicking", func(t *testing.T) {
		t.Parallel()

		host := "example.com"
		port := 3000
		result := checkServiceHealth(context.Background(), ResolvedHealthConfig{Kind: "tcp", Host: &host, Port: &port}, healthDependencies{
			canConnectToPort: func(ctx context.Context, host string, port int, timeout time.Duration) bool {
				t.Fatal("canConnectToPort should not be called for unsupported hosts")
				return false
			},
			isReadyHTTPEndpoint: func(ctx context.Context, url string, timeout time.Duration) bool { return false },
		})
		if result {
			t.Fatal("checkServiceHealth(...) = true, want false")
		}
	})
}

func TestIsReadyHTTPEndpoint(t *testing.T) {
	t.Parallel()

	t.Run("treats redirects as not ready", func(t *testing.T) {
		t.Parallel()

		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			http.Redirect(writer, request, "/ready", http.StatusFound)
		}))
		defer server.Close()

		if isReadyHTTPEndpoint(context.Background(), server.URL, minProbeTimeout) {
			t.Fatal("isReadyHTTPEndpoint(...) = true, want false")
		}
	})

	t.Run("network failures are not ready", func(t *testing.T) {
		t.Parallel()

		if isReadyHTTPEndpoint(context.Background(), "http://127.0.0.1:1/healthz", minProbeTimeout) {
			t.Fatal("isReadyHTTPEndpoint(...) = true, want false")
		}
	})
}

func stringPointer(value string) *string {
	return &value
}

func intPointer(value int) *int {
	return &value
}

func TestCanConnectToPort(t *testing.T) {
	t.Parallel()

	listener, listenError := net.Listen("tcp", "127.0.0.1:0")
	if listenError != nil {
		t.Fatalf("net.Listen(...) error = %v", listenError)
	}
	defer listener.Close()

	acceptDone := make(chan error, 1)
	go func() {
		connection, acceptError := listener.Accept()
		if acceptError != nil {
			acceptDone <- acceptError
			return
		}
		_ = connection.Close()
		acceptDone <- nil
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	if !canConnectToPort(context.Background(), "127.0.0.1", port, minProbeTimeout) {
		t.Fatal("canConnectToPort(...) = false, want true")
	}

	acceptError := <-acceptDone
	if acceptError != nil && !errors.Is(acceptError, net.ErrClosed) {
		t.Fatalf("listener.Accept(...) error = %v", acceptError)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if canConnectToPort(ctx, "127.0.0.1", port, minProbeTimeout) {
		t.Fatal("cancelled probe connected to a listening port")
	}

	if canConnectToPort(context.Background(), "127.0.0.1", 1, minProbeTimeout) {
		t.Fatal("canConnectToPort(...) = true, want false")
	}
}
