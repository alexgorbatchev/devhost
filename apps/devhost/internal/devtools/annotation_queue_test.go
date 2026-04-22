package devtools

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestAnnotationQueueStoreEnqueueAndDrain(t *testing.T) {
	t.Parallel()

	harness := newAnnotationQueueHarness(t, nil)
	first := testAnnotationDetail("First annotation", 1, "https://app.localhost/dashboard")
	second := testAnnotationDetail("Second annotation", 2, "https://app.localhost/settings/profile")

	result, err := harness.store.enqueue(first, nil)
	if err != nil {
		t.Fatalf("enqueue(first) error = %v", err)
	}
	if result.SessionID != "session-1" {
		t.Fatalf("enqueue(first) session = %q, want session-1", result.SessionID)
	}
	harness.setSessionStatus(result.SessionID, agentSessionStatusWorking)
	if err := harness.store.handleAgentStatus(result.SessionID, agentSessionStatusWorking); err != nil {
		t.Fatalf("handleAgentStatus(working) error = %v", err)
	}

	result, err = harness.store.enqueue(second, &result.SessionID)
	if err != nil {
		t.Fatalf("enqueue(second) error = %v", err)
	}
	if result.SessionID != "session-1" {
		t.Fatalf("enqueue(second) session = %q, want session-1", result.SessionID)
	}
	if len(harness.startedAnnotations) != 1 {
		t.Fatalf("started annotations = %d, want 1", len(harness.startedAnnotations))
	}

	if err := harness.store.handleAgentStatus(result.SessionID, agentSessionStatusFinished); err != nil {
		t.Fatalf("handleAgentStatus(finished) error = %v", err)
	}
	if len(harness.writtenAnnotations) != 1 || harness.writtenAnnotations[0].annotation.Comment != second.Comment {
		t.Fatalf("written annotations = %#v, want second annotation", harness.writtenAnnotations)
	}

	snapshot := harness.store.getSnapshot()
	if len(snapshot) != 1 || len(snapshot[0].Entries) != 1 || snapshot[0].Entries[0].Annotation.Comment != second.Comment || snapshot[0].Status != annotationQueueStatusLaunching {
		t.Fatalf("snapshot after drain = %#v", snapshot)
	}
}

func TestAnnotationQueueStorePauseResumeAndPersistence(t *testing.T) {
	t.Parallel()

	harness := newAnnotationQueueHarness(t, nil)
	annotation := testAnnotationDetail("First annotation", 1, "https://app.localhost/dashboard")
	result, err := harness.store.enqueue(annotation, nil)
	if err != nil {
		t.Fatalf("enqueue(...) error = %v", err)
	}
	if err := harness.store.handleSessionExited(result.SessionID); err != nil {
		t.Fatalf("handleSessionExited(...) error = %v", err)
	}

	snapshot := harness.store.getSnapshot()
	if len(snapshot) != 1 || snapshot[0].Status != annotationQueueStatusPaused || snapshot[0].PauseReason == nil || *snapshot[0].PauseReason != string(annotationQueuePauseReasonSessionExited) {
		t.Fatalf("paused snapshot = %#v", snapshot)
	}

	resumed, err := harness.store.resumeQueue(snapshot[0].QueueID)
	if err != nil {
		t.Fatalf("resumeQueue(...) error = %v", err)
	}
	if resumed.SessionID != "session-2" {
		t.Fatalf("resumeQueue(...) session = %q, want session-2", resumed.SessionID)
	}

	persistedPayload, err := os.ReadFile(harness.queueFilePath)
	if err != nil {
		t.Fatalf("ReadFile(queue) error = %v", err)
	}
	var persistedState persistedAnnotationQueueState
	if err := json.Unmarshal(persistedPayload, &persistedState); err != nil {
		t.Fatalf("Unmarshal(queue) error = %v", err)
	}
	if len(persistedState.Queues) != 1 || persistedState.Queues[0].QueueID == "" {
		t.Fatalf("persisted state = %#v", persistedState)
	}
}

func TestAnnotationQueueStoreRepairsCorruptPersistedQueues(t *testing.T) {
	t.Parallel()

	stateDirectoryPath := t.TempDir()
	manifestPath := "/tmp/project/devhost.toml"
	queueFilePath := createAnnotationQueueFilePath(stateDirectoryPath, "hello-stack", manifestPath)
	if err := os.MkdirAll(filepath.Dir(queueFilePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(queueFilePath, []byte(`{"queues":[{"currentEntry":null,"pendingEntries":[{"annotation":{"comment":"Recovered","markers":[],"stackName":"hello-stack","submittedAt":2,"title":"Example","url":"https://example.test/path"},"createdAt":2,"entryId":"entry-2","updatedAt":2}],"queueId":"queue-1"}],"version":1}`), 0o600); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	store := newAnnotationQueueStore(annotationQueueStoreOptions{
		manifestPath:             manifestPath,
		readLiveAgentSession:     func(string) *liveAgentSessionSnapshot { return nil },
		stackName:                "hello-stack",
		startAgentSession:        func(annotation annotationSubmitDetail) (string, error) { return "session-1", nil },
		stateDirectoryPath:       stateDirectoryPath,
		writeAnnotationToSession: func(string, annotationSubmitDetail) error { return nil },
	})

	snapshot := store.getSnapshot()
	if len(snapshot) != 1 || len(snapshot[0].Entries) != 1 || snapshot[0].Entries[0].Annotation.Comment != "Recovered" {
		t.Fatalf("repaired snapshot = %#v", snapshot)
	}
}

func TestAnnotationQueueStoreValidatesMutationConflicts(t *testing.T) {
	t.Parallel()

	harness := newAnnotationQueueHarness(t, nil)
	result, err := harness.store.enqueue(testAnnotationDetail("First annotation", 1, "https://example.test/path"), nil)
	if err != nil {
		t.Fatalf("enqueue(...) error = %v", err)
	}
	entryID := harness.store.getSnapshot()[0].Entries[0].EntryID

	if err := harness.store.updateEntryComment(entryID, "Updated"); !errors.Is(err, errAnnotationQueueConflict) {
		t.Fatalf("updateEntryComment(active) error = %v, want conflict", err)
	}
	if err := harness.store.deleteEntry(entryID); !errors.Is(err, errAnnotationQueueConflict) {
		t.Fatalf("deleteEntry(active) error = %v, want conflict", err)
	}
	if _, err := harness.store.resumeQueue(harness.store.getSnapshot()[0].QueueID); !errors.Is(err, errAnnotationQueueConflict) {
		t.Fatalf("resumeQueue(active) error = %v, want conflict", err)
	}
	if err := harness.store.handleSessionExited(result.SessionID); err != nil {
		t.Fatalf("handleSessionExited(...) error = %v", err)
	}
	if err := harness.store.updateEntryComment(entryID, "  "); !errors.Is(err, errAnnotationQueueValidation) {
		t.Fatalf("updateEntryComment(blank) error = %v, want validation", err)
	}
}

func TestAnnotationQueueStoreBucketsQueuesByRoutedService(t *testing.T) {
	t.Parallel()

	routedServices := []RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: "web"}, {Host: "app.localhost", Path: "/api/*", ServiceName: "api"}}
	harness := newAnnotationQueueHarness(t, routedServices)
	first, err := harness.store.enqueue(testAnnotationDetail("Web annotation", 1, "https://app.localhost/dashboard"), nil)
	if err != nil {
		t.Fatalf("enqueue(web) error = %v", err)
	}
	second, err := harness.store.enqueue(testAnnotationDetail("API annotation", 2, "https://app.localhost/api/users"), nil)
	if err != nil {
		t.Fatalf("enqueue(api) error = %v", err)
	}
	if first.SessionID == second.SessionID {
		t.Fatalf("session IDs = %q and %q, want separate routed-service queues", first.SessionID, second.SessionID)
	}
}

func TestAnnotationQueueStoreRejectsMismatchedTargetSessionQueueReuse(t *testing.T) {
	t.Parallel()

	routedServices := []RoutedServiceIdentity{{Host: "app.localhost", Path: "/", ServiceName: "web"}, {Host: "app.localhost", Path: "/api/*", ServiceName: "api"}}
	harness := newAnnotationQueueHarness(t, routedServices)
	first, err := harness.store.enqueue(testAnnotationDetail("Web annotation", 1, "https://app.localhost/dashboard"), nil)
	if err != nil {
		t.Fatalf("enqueue(web) error = %v", err)
	}
	second, err := harness.store.enqueue(testAnnotationDetail("API annotation", 2, "https://app.localhost/api/users"), &first.SessionID)
	if err != nil {
		t.Fatalf("enqueue(api,target) error = %v", err)
	}
	if second.SessionID == first.SessionID {
		t.Fatalf("targeted API session reused web queue session %q", second.SessionID)
	}
}

func TestAnnotationQueueStoreResumePersistedQueuesSkipsUserTerminated(t *testing.T) {
	t.Parallel()

	stateDirectoryPath := t.TempDir()
	manifestPath := "/tmp/project/devhost.toml"
	queueFilePath := createAnnotationQueueFilePath(stateDirectoryPath, "hello-stack", manifestPath)
	if err := os.MkdirAll(filepath.Dir(queueFilePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(queueFilePath, []byte(`{"queues":[{"currentEntry":{"annotation":{"comment":"Auto resume annotation","markers":[],"stackName":"hello-stack","submittedAt":1,"title":"Example","url":"https://example.test/auto"},"createdAt":1,"entryId":"entry-1","updatedAt":1},"pauseReason":"shutdown","pendingEntries":[],"queueId":"queue-auto"},{"currentEntry":{"annotation":{"comment":"Manual resume annotation","markers":[],"stackName":"hello-stack","submittedAt":2,"title":"Example","url":"https://example.test/manual"},"createdAt":2,"entryId":"entry-2","updatedAt":2},"pauseReason":"user-terminated","pendingEntries":[],"queueId":"queue-manual"}],"version":1}`), 0o600); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	harness := &annotationQueueHarness{liveSessions: map[string]*liveAgentSessionSnapshot{}, startedAnnotations: []annotationSubmitDetail{}, writtenAnnotations: []writtenAnnotationRecord{}, nextSessionSequence: 1}
	harness.store = newAnnotationQueueStore(annotationQueueStoreOptions{
		manifestPath: manifestPath,
		readLiveAgentSession: func(string) *liveAgentSessionSnapshot {
			return nil
		},
		stackName:          "hello-stack",
		stateDirectoryPath: stateDirectoryPath,
		startAgentSession: func(annotation annotationSubmitDetail) (string, error) {
			harness.startedAnnotations = append(harness.startedAnnotations, annotation)
			return fmt.Sprintf("session-%d", len(harness.startedAnnotations)), nil
		},
		writeAnnotationToSession: func(string, annotationSubmitDetail) error { return nil },
	})

	if err := harness.store.resumePersistedQueues(); err != nil {
		t.Fatalf("resumePersistedQueues(...) error = %v", err)
	}
	if len(harness.startedAnnotations) != 1 || harness.startedAnnotations[0].Comment != "Auto resume annotation" {
		t.Fatalf("started annotations = %#v", harness.startedAnnotations)
	}
	snapshot := harness.store.getSnapshot()
	if len(snapshot) != 2 || snapshot[1].PauseReason == nil || *snapshot[1].PauseReason != string(annotationQueuePauseReasonUserTerminated) {
		t.Fatalf("snapshot after resume = %#v", snapshot)
	}
}

func TestAnnotationQueueStoreRemovesEmptyPersistedStateAfterFinish(t *testing.T) {
	t.Parallel()

	harness := newAnnotationQueueHarness(t, nil)
	result, err := harness.store.enqueue(testAnnotationDetail("Done annotation", 1, "https://example.test/path"), nil)
	if err != nil {
		t.Fatalf("enqueue(...) error = %v", err)
	}
	if err := harness.store.handleAgentStatus(result.SessionID, agentSessionStatusFinished); err != nil {
		t.Fatalf("handleAgentStatus(finished) error = %v", err)
	}
	if _, err := os.Stat(harness.queueFilePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat(queue file) error = %v, want not-exist", err)
	}
}

func TestAnnotationQueueStoreRenamesCorruptQueueFilesAside(t *testing.T) {
	t.Parallel()

	stateDirectoryPath := t.TempDir()
	manifestPath := "/tmp/project/devhost.toml"
	queueFilePath := createAnnotationQueueFilePath(stateDirectoryPath, "hello-stack", manifestPath)
	if err := os.MkdirAll(filepath.Dir(queueFilePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(queueFilePath, []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	store := newAnnotationQueueStore(annotationQueueStoreOptions{
		manifestPath:             manifestPath,
		readLiveAgentSession:     func(string) *liveAgentSessionSnapshot { return nil },
		stackName:                "hello-stack",
		startAgentSession:        func(annotation annotationSubmitDetail) (string, error) { return "session-1", nil },
		stateDirectoryPath:       stateDirectoryPath,
		writeAnnotationToSession: func(string, annotationSubmitDetail) error { return nil },
	})

	if snapshot := store.getSnapshot(); len(snapshot) != 0 {
		t.Fatalf("snapshot from corrupt queue = %#v, want empty", snapshot)
	}
	entries, err := os.ReadDir(filepath.Dir(queueFilePath))
	if err != nil {
		t.Fatalf("ReadDir(...) error = %v", err)
	}
	foundCorruptCopy := false
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".corrupt-") {
			foundCorruptCopy = true
			break
		}
	}
	if !foundCorruptCopy {
		t.Fatalf("directory entries = %#v, want corrupt backup", entries)
	}
}

func TestWriteFileDurablySyncsAndRenames(t *testing.T) {
	originalOpenFile := annotationQueueOpenFile
	originalRenameFile := annotationQueueRenameFile
	originalSyncFile := annotationQueueSyncFile
	originalSyncDirectory := annotationQueueSyncDirectory
	defer func() {
		annotationQueueOpenFile = originalOpenFile
		annotationQueueRenameFile = originalRenameFile
		annotationQueueSyncFile = originalSyncFile
		annotationQueueSyncDirectory = originalSyncDirectory
	}()

	filePath := filepath.Join(t.TempDir(), "queues", "state.json")
	callOrder := []string{}
	targetDirectoryPath := filepath.Dir(filePath)
	annotationQueueRenameFile = func(oldPath string, newPath string) error {
		if filepath.Dir(newPath) == targetDirectoryPath {
			callOrder = append(callOrder, "rename")
		}
		return originalRenameFile(oldPath, newPath)
	}
	annotationQueueSyncFile = func(file *os.File) error {
		if filepath.Dir(file.Name()) == targetDirectoryPath {
			callOrder = append(callOrder, "file-sync")
		}
		return originalSyncFile(file)
	}
	annotationQueueSyncDirectory = func(directoryPath string) error {
		if directoryPath == targetDirectoryPath {
			callOrder = append(callOrder, "dir-sync")
		}
		return originalSyncDirectory(directoryPath)
	}

	payload := []byte(`{"version":1}`)
	if err := writeFileDurably(filePath, payload, 0o600); err != nil {
		t.Fatalf("writeFileDurably(...) error = %v", err)
	}

	if !slices.Equal(callOrder, []string{"file-sync", "rename", "dir-sync"}) {
		t.Fatalf("call order = %#v, want file-sync -> rename -> dir-sync", callOrder)
	}

	storedPayload, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if string(storedPayload) != string(payload) {
		t.Fatalf("stored payload = %q, want %q", string(storedPayload), string(payload))
	}

	entries, err := os.ReadDir(filepath.Dir(filePath))
	if err != nil {
		t.Fatalf("ReadDir(...) error = %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "state.json" {
		t.Fatalf("directory entries = %#v, want only state.json", entries)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("Stat(...) error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %#o, want 0o600", info.Mode().Perm())
	}
}

func TestRemoveFileDurablyRemovesFileAndSyncsDirectory(t *testing.T) {
	originalRemoveFile := annotationQueueRemoveFile
	originalSyncDirectory := annotationQueueSyncDirectory
	defer func() {
		annotationQueueRemoveFile = originalRemoveFile
		annotationQueueSyncDirectory = originalSyncDirectory
	}()

	filePath := filepath.Join(t.TempDir(), "queues", "state.json")
	callOrder := []string{}
	targetDirectoryPath := filepath.Dir(filePath)
	annotationQueueRemoveFile = func(filePath string) error {
		if filepath.Dir(filePath) == targetDirectoryPath {
			callOrder = append(callOrder, "remove")
		}
		return originalRemoveFile(filePath)
	}
	annotationQueueSyncDirectory = func(directoryPath string) error {
		if directoryPath == targetDirectoryPath {
			callOrder = append(callOrder, "dir-sync")
		}
		return originalSyncDirectory(directoryPath)
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("{}"), 0o600); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	if err := removeFileDurably(filePath); err != nil {
		t.Fatalf("removeFileDurably(...) error = %v", err)
	}

	if !slices.Equal(callOrder, []string{"remove", "dir-sync"}) {
		t.Fatalf("call order = %#v, want remove -> dir-sync", callOrder)
	}

	if _, err := os.Stat(filePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat(...) error = %v, want os.ErrNotExist", err)
	}
}

type annotationQueueHarness struct {
	liveSessions        map[string]*liveAgentSessionSnapshot
	queueFilePath       string
	startedAnnotations  []annotationSubmitDetail
	store               *annotationQueueStore
	writtenAnnotations  []writtenAnnotationRecord
	nextSessionSequence int
}

type writtenAnnotationRecord struct {
	annotation annotationSubmitDetail
	sessionID  string
}

func newAnnotationQueueHarness(t *testing.T, routedServices []RoutedServiceIdentity) *annotationQueueHarness {
	t.Helper()
	stateDirectoryPath := t.TempDir()
	manifestPath := "/tmp/project/devhost.toml"
	harness := &annotationQueueHarness{
		liveSessions:        map[string]*liveAgentSessionSnapshot{},
		queueFilePath:       createAnnotationQueueFilePath(stateDirectoryPath, "hello-stack", manifestPath),
		startedAnnotations:  []annotationSubmitDetail{},
		writtenAnnotations:  []writtenAnnotationRecord{},
		nextSessionSequence: 1,
	}
	harness.store = newAnnotationQueueStore(annotationQueueStoreOptions{
		manifestPath: manifestPath,
		readLiveAgentSession: func(sessionID string) *liveAgentSessionSnapshot {
			return harness.liveSessions[sessionID]
		},
		routedServices:     routedServices,
		stackName:          "hello-stack",
		stateDirectoryPath: stateDirectoryPath,
		startAgentSession: func(annotation annotationSubmitDetail) (string, error) {
			sessionID := fmt.Sprintf("session-%d", harness.nextSessionSequence)
			harness.nextSessionSequence += 1
			harness.startedAnnotations = append(harness.startedAnnotations, annotation)
			harness.liveSessions[sessionID] = &liveAgentSessionSnapshot{annotation: annotation, sessionID: sessionID}
			return sessionID, nil
		},
		writeAnnotationToSession: func(sessionID string, annotation annotationSubmitDetail) error {
			liveSession := harness.liveSessions[sessionID]
			if liveSession == nil {
				return errors.New("missing live session")
			}
			liveSession.annotation = annotation
			liveSession.agentStatus = nil
			harness.writtenAnnotations = append(harness.writtenAnnotations, writtenAnnotationRecord{annotation: annotation, sessionID: sessionID})
			return nil
		},
	})
	return harness
}

func (h *annotationQueueHarness) setSessionStatus(sessionID string, status agentSessionStatus) {
	liveSession := h.liveSessions[sessionID]
	if liveSession == nil {
		return
	}
	liveSession.agentStatus = &status
}

func testAnnotationDetail(comment string, submittedAt int64, url string) annotationSubmitDetail {
	return annotationSubmitDetail{
		Comment:     comment,
		Markers:     []annotationMarkerPayload{},
		StackName:   "hello-stack",
		SubmittedAt: submittedAt,
		Title:       "Example",
		URL:         url,
	}
}
