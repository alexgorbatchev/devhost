package devtools

import (
	"net/http"
	"strconv"
)

// Preview snapshots deliberately stay in a non-ready phase, so polling never
// navigates away from the example. They do not read or mutate the live stack.
func pagePreviewState(name string) (RecoveryState, int, bool) {
	state := RecoveryState{
		Stack: "preview", Service: "web", Phase: "unavailable", CanRestart: true,
		Address: "127.0.0.1:3000",
		Logs:    []string{"[web] Starting development server", "[web] Could not resolve an application import", "[web] Waiting for file changes…"},
	}
	status := http.StatusServiceUnavailable
	switch name {
	case "starting":
		state.Phase, state.Title = "starting", "Starting web"
		state.Message = "Waiting for the service to accept connections on its assigned address."
		state.CanRestart = false
		state.Logs = []string{"[web] Starting development server", "[web] Checking TCP readiness at 127.0.0.1:3000"}
	case "failed":
		state.Title, state.Message = "web exited", "The service exited with code 1. Review the logs and restart when ready."
	case "external":
		state.Title, state.Message = "External service unavailable", "Start the external service, then refresh this page."
		state.CanRestart = false
		state.Logs = nil
	case "worktrees":
		status = http.StatusInternalServerError
		state.Repositories = []WorktreeRepository{{
			ID: "preview", Name: "preview-project", SelectedPath: "/preview/main",
			Worktrees: []Worktree{
				{Path: "/preview/main", Branch: "main", Available: true},
				{Path: "/preview/feature", Branch: "feature/design", Available: true},
				{Path: "/preview/missing", Branch: "feature/missing", Reason: "Checkout is unavailable"},
			},
		}}
		setDocumentRecoveryError(&state, status)
	case "404", "500", "502", "503", "504":
		parsed, err := strconv.Atoi(name)
		if err != nil {
			return RecoveryState{}, 0, false
		}
		status = parsed
		setDocumentRecoveryError(&state, status)
	default:
		return RecoveryState{}, 0, false
	}
	return state, status, true
}
