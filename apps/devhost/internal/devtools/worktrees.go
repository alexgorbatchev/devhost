package devtools

import (
	"encoding/json"
	"net/http"
)

const worktreesPath = controlPathPrefix + "/worktrees"

type switchWorktreeRequest struct {
	RepositoryID string `json:"repositoryId"`
	Path         string `json:"path"`
}

func (s *ControlServer) handleWorktrees(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodPost {
		writer.Header().Set("Allow", "GET, POST")
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.switchWorktree == nil || s.refreshWorktrees == nil {
		http.Error(writer, "Worktrees are not enabled.", http.StatusNotImplemented)
		return
	}
	if request.Method == http.MethodGet {
		if err := s.refreshWorktrees(); err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		health, err := s.getHealth()
		if err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		writer.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(writer).Encode(health)
		return
	}
	var payload switchWorktreeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || payload.RepositoryID == "" || payload.Path == "" {
		http.Error(writer, "Invalid worktree selection payload.", http.StatusBadRequest)
		return
	}
	if err := s.switchWorktree(payload.RepositoryID, payload.Path); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(successResponse{Success: true})
}

type WorktreeDirectory struct {
	Name string `json:"name"`
	Cwd  string `json:"cwd"`
}

type Worktree struct {
	Path        string              `json:"path"`
	Branch      string              `json:"branch"`
	Head        string              `json:"head"`
	Detached    bool                `json:"detached"`
	Available   bool                `json:"available"`
	Reason      string              `json:"reason,omitempty"`
	Directories []WorktreeDirectory `json:"directories"`
}

type WorktreeRepository struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	DefaultBranch  string     `json:"defaultBranch"`
	ConfiguredPath string     `json:"configuredPath"`
	SelectedPath   string     `json:"selectedPath"`
	RunningPath    string     `json:"runningPath"`
	ServiceNames   []string   `json:"serviceNames"`
	Worktrees      []Worktree `json:"worktrees"`
	Switching      bool       `json:"switching"`
	Error          string     `json:"error,omitempty"`
	BlockedReason  string     `json:"blockedReason,omitempty"`
}
