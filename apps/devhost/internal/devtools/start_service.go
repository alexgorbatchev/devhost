package devtools

import (
	"encoding/json"
	"net/http"
)

type startServiceRequest struct {
	ServiceNames []string `json:"serviceNames"`
}

// handleStartService starts services the run left stopped, together with the
// services they depend on.
func (s *ControlServer) handleStartService(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var payload startServiceRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		http.Error(writer, "Invalid start service payload.", http.StatusBadRequest)
		return
	}
	if len(payload.ServiceNames) == 0 {
		http.Error(writer, "Invalid start service payload: no services specified.", http.StatusBadRequest)
		return
	}
	if s.startService == nil {
		http.Error(writer, "Start service not supported.", http.StatusNotImplemented)
		return
	}
	if err := s.startService(payload.ServiceNames); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
