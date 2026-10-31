package devtools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
)

const (
	chatPanelPath      = controlPathPrefix + "/chat/panel"
	chatPanelBodyLimit = 1024
)

type chatPanelPosition struct {
	Left float64 `json:"left"`
	Top  float64 `json:"top"`
}

// chatPanelLayout is saved for the manifest rather than in the browser: local
// storage is per origin, and one manifest serves pages on several hostnames.
type chatPanelLayout struct {
	Position *chatPanelPosition `json:"position"`
}

func (l chatPanelLayout) validate() error {
	if l.Position == nil {
		return nil
	}
	for _, value := range []float64{l.Position.Left, l.Position.Top} {
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return errors.New("chat panel position must be finite and not negative")
		}
	}
	return nil
}

func readChatPanelLayout(path string) (chatPanelLayout, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return chatPanelLayout{}, nil
	}
	if err != nil {
		return chatPanelLayout{}, fmt.Errorf("read chat panel layout: %w", err)
	}
	var layout chatPanelLayout
	if err := json.Unmarshal(data, &layout); err != nil || layout.validate() != nil {
		// A damaged file only costs the saved position.
		return chatPanelLayout{}, nil
	}
	return layout, nil
}

// writeChatPanelLayout replaces the file whole, so a stack reading it during a
// save sees the previous layout or this one.
func writeChatPanelLayout(path string, layout chatPanelLayout) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create chat panel state: %w", err)
	}
	data, err := json.Marshal(layout)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".chat-panel-*")
	if err != nil {
		return fmt.Errorf("save chat panel layout: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		_ = file.Close() // The write failure is the one to report.
		return fmt.Errorf("save chat panel layout: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("save chat panel layout: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("save chat panel layout: %w", err)
	}
	return nil
}

func (s *ControlServer) handleChatPanel(w http.ResponseWriter, r *http.Request) {
	if s.chatPanelFile == "" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		layout, err := readChatPanelLayout(s.chatPanelFile)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		chatJSON(w, layout)
	case http.MethodPut:
		if !requireChatPage(w, r) {
			return
		}
		var layout chatPanelLayout
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, chatPanelBodyLimit))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&layout); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := layout.validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := writeChatPanelLayout(s.chatPanelFile, layout); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
