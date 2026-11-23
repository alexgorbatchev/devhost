package devtools

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"testing"
)

func TestControlServerStackInfoEndpointAndGuards(t *testing.T) {
	port := 22250
	exitCode := 1
	want := StackInfoSnapshot{
		Name:          "Acme Shop",
		ManifestFiles: []string{"/project/devhost.toml", "/project/admin/devhost.toml"},
		Services: []StackServiceInfo{
			{Name: "web", State: "ready", Primary: true, Since: "2026-11-20T14:01:02Z", Port: &port, URLs: []string{"https://shop.localhost"}},
			{Name: "api", State: "exited", ExitCode: &exitCode, Since: "2026-11-20T14:01:53Z", LastOutput: "database connection failed"},
		},
	}

	server, err := StartControlServer(StartControlServerOptions{
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{}, nil },
		GetStackInfo:      func(context.Context) (StackInfoSnapshot, error) { return want, nil },
		StackName:         "Acme Shop",
	})
	if err != nil {
		t.Fatalf("StartControlServer() error = %v", err)
	}
	t.Cleanup(func() { _ = server.Stop() })

	got, err := ReadStackInfo(context.Background(), server.Port())
	if err != nil {
		t.Fatalf("ReadStackInfo() error = %v", err)
	}
	if got.Name != want.Name || !slices.Equal(got.ManifestFiles, want.ManifestFiles) || len(got.Services) != 2 {
		t.Fatalf("ReadStackInfo() = %+v, want %+v", got, want)
	}
	if got.Services[0].Name != "web" || !got.Services[0].Primary || got.Services[0].Port == nil || *got.Services[0].Port != port {
		t.Fatalf("web service = %+v", got.Services[0])
	}
	if got.Services[1].State != "exited" || got.Services[1].ExitCode == nil || *got.Services[1].ExitCode != exitCode || got.Services[1].LastOutput != "database connection failed" {
		t.Fatalf("api service = %+v", got.Services[1])
	}

	endpoint := fmt.Sprintf("http://127.0.0.1:%d%s", server.Port(), stackInfoPath)

	// Non-loopback Host header must be rejected so routed browser origins cannot read stack info.
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "shop.localhost"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-loopback host status = %d, want 403", resp.StatusCode)
	}

	// Non-GET/HEAD method must be rejected.
	postReq, err := http.NewRequest(http.MethodPost, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = postResp.Body.Close()
	if postResp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", postResp.StatusCode)
	}

	// Cross-origin Origin header must be rejected.
	originReq, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	originReq.Header.Set("Origin", "https://evil.example")
	originResp, err := http.DefaultClient.Do(originReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = originResp.Body.Close()
	if originResp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d, want 403", originResp.StatusCode)
	}

	// Invalid control ports fail before dialing.
	if _, err := ReadStackInfo(context.Background(), 0); err == nil {
		t.Fatal("ReadStackInfo(0) error = nil, want error")
	}
}
