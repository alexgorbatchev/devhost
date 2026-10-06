package devtools

import "net/http"

func (s *ControlServer) handleRestartStack(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.restartStack == nil {
		http.Error(writer, "Restart stack not supported.", http.StatusNotImplemented)
		return
	}
	if err := s.restartStack(); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
