package services

import (
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

		error := WaitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "process", Interval: 200, Timeout: 30000, Retries: 0},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "worker",
		})
		if error != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", error)
		}
	})

	t.Run("waits for a tcp port to accept connections", func(t *testing.T) {
		t.Parallel()

		listener, error := net.Listen("tcp", "127.0.0.1:0")
		if error != nil {
			t.Fatalf("net.Listen(...) error = %v", error)
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
		error = WaitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Host: &host, Interval: 200, Port: &port, Retries: 0, Timeout: 30000},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		})
		if error != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", error)
		}

		<-acceptDone
	})

	t.Run("waits for an http health endpoint", func(t *testing.T) {
		t.Parallel()

		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		error := WaitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "http", Interval: 200, Retries: 0, Timeout: 30000, URL: &server.URL},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "api",
		})
		if error != nil {
			t.Fatalf("WaitForServiceHealth(...) unexpected error = %v", error)
		}
	})

	t.Run("fails fast when the child exits before passing its health check", func(t *testing.T) {
		t.Parallel()

		exitCode := 2
		host := "127.0.0.1"
		port := 65534
		error := waitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Host: &host, Interval: 1, Port: &port, Retries: 0, Timeout: 100},
			ReadExitCode: func() *int {
				return &exitCode
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort:    func(host string, port int) bool { return false },
			isReadyHTTPEndpoint: func(url string) bool { return false },
			now:                 time.Now,
			sleep:               func(duration time.Duration) {},
		})
		wantError := "Service web exited before passing its health check with code 2."
		if error == nil || error.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", error, wantError)
		}
	})

	t.Run("retries zero keeps polling until timeout", func(t *testing.T) {
		t.Parallel()

		checks := 0
		currentTime := time.Unix(0, 0)
		error := waitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Interval: 10, Retries: 0, Timeout: 30, Host: stringPointer("127.0.0.1"), Port: intPointer(3000)},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort: func(host string, port int) bool {
				checks++
				return false
			},
			isReadyHTTPEndpoint: func(url string) bool { return false },
			now: func() time.Time {
				return currentTime
			},
			sleep: func(duration time.Duration) {
				currentTime = currentTime.Add(duration)
			},
		})
		wantError := "Service web did not pass its health check within 30ms."
		if error == nil || error.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", error, wantError)
		}
		if checks != 3 {
			t.Fatalf("WaitForServiceHealth(...) checks = %d, want 3", checks)
		}
	})

	t.Run("positive retries fail early after consecutive failures", func(t *testing.T) {
		t.Parallel()

		checks := 0
		currentTime := time.Unix(0, 0)
		error := waitForServiceHealth(WaitForServiceHealthOptions{
			Health: ResolvedHealthConfig{Kind: "tcp", Interval: 10, Retries: 2, Timeout: 1000, Host: stringPointer("127.0.0.1"), Port: intPointer(3000)},
			ReadExitCode: func() *int {
				return nil
			},
			ServiceName: "web",
		}, healthDependencies{
			canConnectToPort: func(host string, port int) bool {
				checks++
				return false
			},
			isReadyHTTPEndpoint: func(url string) bool { return false },
			now: func() time.Time {
				return currentTime
			},
			sleep: func(duration time.Duration) {
				currentTime = currentTime.Add(duration)
			},
		})
		wantError := "Service web failed its health check 3 consecutive times."
		if error == nil || error.Error() != wantError {
			t.Fatalf("WaitForServiceHealth(...) error = %v, want %q", error, wantError)
		}
		if checks != 3 {
			t.Fatalf("WaitForServiceHealth(...) checks = %d, want 3", checks)
		}
	})
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
		result := checkServiceHealth(ResolvedHealthConfig{Kind: "tcp", Host: &host, Port: &port}, healthDependencies{
			canConnectToPort: func(host string, port int) bool {
				calls++
				return host == "127.0.0.1" && port == 3000
			},
			isReadyHTTPEndpoint: func(url string) bool { return false },
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
		result := checkServiceHealth(ResolvedHealthConfig{Kind: "http", URL: &url}, healthDependencies{
			canConnectToPort: func(host string, port int) bool { return false },
			isReadyHTTPEndpoint: func(url string) bool {
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
		result := checkServiceHealth(ResolvedHealthConfig{Kind: "tcp", Host: &host, Port: &port}, healthDependencies{
			canConnectToPort: func(host string, port int) bool {
				t.Fatal("canConnectToPort should not be called for unsupported hosts")
				return false
			},
			isReadyHTTPEndpoint: func(url string) bool { return false },
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

		if isReadyHTTPEndpoint(server.URL) {
			t.Fatal("isReadyHTTPEndpoint(...) = true, want false")
		}
	})

	t.Run("network failures are not ready", func(t *testing.T) {
		t.Parallel()

		if isReadyHTTPEndpoint("http://127.0.0.1:1/healthz") {
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
	if !canConnectToPort("127.0.0.1", port) {
		t.Fatal("canConnectToPort(...) = false, want true")
	}

	acceptError := <-acceptDone
	if acceptError != nil && !errors.Is(acceptError, net.ErrClosed) {
		t.Fatalf("listener.Accept(...) error = %v", acceptError)
	}

	if canConnectToPort("127.0.0.1", 1) {
		t.Fatal("canConnectToPort(...) = true, want false")
	}
}
