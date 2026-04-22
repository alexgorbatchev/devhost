package devtools

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

const (
	annotationQueuesPath          = controlPathPrefix + "/annotation-queues"
	annotationQueuesWebsocketPath = controlPathPrefix + "/ws/annotation-queues"
)

func (s *ControlServer) handleAnnotationQueues(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get(controlTokenHeaderName) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}
	if s.annotationQueueStore == nil {
		http.Error(writer, "Annotation queues are not configured.", http.StatusNotImplemented)
		return
	}

	if request.URL.Path == annotationQueuesPath {
		s.handleAnnotationQueueCollection(writer, request)
		return
	}

	entryID := readAnnotationQueueEntryID(request.URL.Path)
	if entryID != "" {
		s.handleAnnotationQueueEntry(writer, request, entryID)
		return
	}

	queueID := readAnnotationQueueResumeID(request.URL.Path)
	if queueID != "" {
		s.handleAnnotationQueueResume(writer, request, queueID)
		return
	}

	http.NotFound(writer, request)
}

func (s *ControlServer) handleAnnotationQueueCollection(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(listAnnotationQueuesResponse{Queues: s.annotationQueueStore.getSnapshot()})
}

func (s *ControlServer) handleAnnotationQueueEntry(writer http.ResponseWriter, request *http.Request, entryID string) {
	switch request.Method {
	case http.MethodPatch:
		var payload struct {
			Comment string `json:"comment"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			http.Error(writer, "Invalid annotation queue payload.", http.StatusBadRequest)
			return
		}
		if err := s.annotationQueueStore.updateEntryComment(entryID, payload.Comment); err != nil {
			writeAnnotationQueueMutationError(writer, err)
			return
		}
	case http.MethodDelete:
		if err := s.annotationQueueStore.deleteEntry(entryID); err != nil {
			writeAnnotationQueueMutationError(writer, err)
			return
		}
	default:
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(successResponse{Success: true})
}

func (s *ControlServer) handleAnnotationQueueResume(writer http.ResponseWriter, request *http.Request, queueID string) {
	if request.Method != http.MethodPost {
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	result, err := s.annotationQueueStore.resumeQueue(queueID)
	if err != nil {
		writeAnnotationQueueMutationError(writer, err)
		return
	}

	writer.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(writer).Encode(resumeAnnotationQueueResponse{SessionID: result.SessionID, Success: true})
}

func (s *ControlServer) handleAnnotationQueueWebsocket(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Query().Get(terminalSessionWebsocketQueryToken) != s.controlToken {
		http.Error(writer, "Forbidden", http.StatusForbidden)
		return
	}
	if s.annotationQueueStore == nil {
		http.Error(writer, "Annotation queues are not configured.", http.StatusNotImplemented)
		return
	}

	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	snapshot := s.annotationQueueStore.getSnapshot()
	s.mu.Lock()
	if s.annotationQueueClients == nil {
		s.annotationQueueClients = map[*websocketClient]struct{}{}
	}
	s.annotationQueueClients[client] = struct{}{}
	s.mu.Unlock()

	if err := writeJSONMessage(client, createAnnotationQueueSnapshotMessage(snapshot)); err != nil {
		s.removeAnnotationQueueClient(client)
		return
	}

	go func() {
		defer s.removeAnnotationQueueClient(client)
		for {
			if _, _, err := client.conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

func (s *ControlServer) publishAnnotationQueues(snapshot []annotationQueueSnapshot) {
	s.mu.Lock()
	clients := snapshotClients(s.annotationQueueClients)
	s.mu.Unlock()
	message := createAnnotationQueueSnapshotMessage(snapshot)
	for _, client := range clients {
		if err := writeJSONMessage(client, message); err != nil {
			s.removeAnnotationQueueClient(client)
		}
	}
}

func (s *ControlServer) removeAnnotationQueueClient(client *websocketClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.annotationQueueClients, client)
	client.close()
}

func readAnnotationQueueEntryID(path string) string {
	prefix := annotationQueuesPath + "/"
	if !strings.HasPrefix(path, prefix) || strings.HasSuffix(path, "/resume") {
		return ""
	}
	entryID := strings.TrimPrefix(path, prefix)
	if entryID == "" || strings.Contains(entryID, "/") {
		return ""
	}
	return entryID
}

func readAnnotationQueueResumeID(path string) string {
	prefix := annotationQueuesPath + "/"
	suffix := "/resume"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return ""
	}
	queueID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if queueID == "" || strings.Contains(queueID, "/") {
		return ""
	}
	return queueID
}

func writeAnnotationQueueMutationError(writer http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, errAnnotationQueueValidation) {
		status = http.StatusBadRequest
	} else if errors.Is(err, errAnnotationQueueNotFound) {
		status = http.StatusNotFound
	} else if errors.Is(err, errAnnotationQueueConflict) {
		status = http.StatusConflict
	}
	http.Error(writer, err.Error(), status)
}
