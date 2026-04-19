package caddy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnsureManagedCaddyAdminAvailable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	if error := EnsureManagedCaddyAdminAvailable(server.URL, AdminAvailabilityDependencies{HTTPClient: server.Client()}); error != nil {
		t.Fatalf("EnsureManagedCaddyAdminAvailable(...) unexpected error = %v", error)
	}
}

func TestCreateManagedCaddyAdminUnavailableErrorMessage(t *testing.T) {
	t.Parallel()

	got := CreateManagedCaddyAdminUnavailableErrorMessage("Get \"http://127.0.0.1:20197/config/\": connection refused Is the computer able to access the url?")
	want := "Caddy admin API is not available. Run 'devhost caddy start' first.\ndetail: Get \"http://127.0.0.1:20197/config/\": connection refused"
	if got != want {
		t.Fatalf("CreateManagedCaddyAdminUnavailableErrorMessage(...) = %q, want %q", got, want)
	}

	got = CreateManagedCaddyAdminUnavailableErrorMessage("")
	want = "Caddy admin API is not available. Run 'devhost caddy start' first."
	if got != want {
		t.Fatalf("CreateManagedCaddyAdminUnavailableErrorMessage(...) = %q, want %q", got, want)
	}
}
