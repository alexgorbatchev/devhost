package services

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

func TestDetachedFinalHealthCheckRespectsCancellation(t *testing.T) {
	entered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime := &stackRuntime{manifest: &ResolvedManifest{Services: map[string]ResolvedService{
		"web": {Name: "web", Health: ResolvedHealthConfig{Kind: HealthKindHTTP, URL: &server.URL, Interval: 30000}},
	}}}
	result := make(chan error, 1)
	go func() { result <- runtime.publishDetachedReady(ctx, caddy.Paths{}) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("final health probe did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("final health check error = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("final health check ignored cancellation")
	}
}
