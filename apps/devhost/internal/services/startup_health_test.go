package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

func TestStartupHealthDiagnostics(t *testing.T) {
	port := nettest.ReservePort(t)
	address := net.JoinHostPort("127.0.0.1", fmt.Sprint(port))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	tests := []struct {
		name   string
		health ResolvedHealthConfig
		want   []string
	}{
		{
			name: "closed TCP port",
			health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: stringPointer("127.0.0.1"), Port: &port,
				Timeout: 30, Interval: 10},
			want: []string{"within 30ms.", "TCP health check could not connect to " + address, "Configure the app to listen on " + address},
		},
		{
			name: "wildcard host and retry limit",
			health: ResolvedHealthConfig{Kind: HealthKindTCP, Host: stringPointer("0.0.0.0"), Port: &port,
				Timeout: 5000, Interval: 10, Retries: 1},
			want: []string{"2 consecutive times.", "TCP health check could not connect to " + address},
		},
		{
			name: "unhealthy HTTP endpoint",
			health: ResolvedHealthConfig{Kind: HealthKindHTTP, URL: &server.URL,
				Timeout: 5000, Interval: 10, Retries: 1},
			want: []string{"2 consecutive times.", "HTTP health check requires a 2xx response from " + server.URL, "services.web.health.http"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := waitForStartupHealth(context.Background(), ResolvedService{Name: "web", Health: tt.health}, startupHealthOptions{logWriter: io.Discard})
			if err == nil {
				t.Fatal("startup health unexpectedly passed")
			}
			for _, want := range tt.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("startup failure = %q, missing %q", err, want)
				}
			}
			if strings.Contains(err.Error(), "succeeded instead") {
				t.Errorf("failure invented an alternative listener: %v", err)
			}
		})
	}
}

func TestStartupHealthPreservesCancellationAndProcessExit(t *testing.T) {
	port := nettest.ReservePort(t)
	service := ResolvedService{Name: "web", Health: ResolvedHealthConfig{
		Kind: HealthKindTCP, Host: stringPointer("127.0.0.1"), Port: &port, Timeout: 5000, Interval: 10,
	}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForStartupHealth(ctx, service, startupHealthOptions{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled startup = %v", err)
	}
	err := waitForStartupHealth(context.Background(), service, startupHealthOptions{readExitCode: func() *int { return intPointer(2) }})
	if err == nil || err.Error() != "Service web exited before passing its health check with code 2." {
		t.Fatalf("process exit was replaced by a network diagnosis: %v", err)
	}
	service.Health = ResolvedHealthConfig{Kind: HealthKindProcess}
	if err := waitForStartupHealth(context.Background(), service, startupHealthOptions{}); err != nil {
		t.Fatalf("healthy process returned a diagnosis: %v", err)
	}
}
