package devtools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	annotationQueuesDirectoryName = "annotation-queues"
	annotationQueuesVersion       = 2
)

var (
	errAnnotationQueueConflict   = errors.New("annotation queue conflict")
	errAnnotationQueueNotFound   = errors.New("annotation queue not found")
	errAnnotationQueueValidation = errors.New("annotation queue validation")
	annotationQueueOpenFile      = os.OpenFile
	annotationQueueRenameFile    = os.Rename
	annotationQueueRemoveFile    = os.Remove
	annotationQueueSyncFile      = func(file *os.File) error {
		return file.Sync()
	}
	annotationQueueSyncDirectory = syncDirectory
)

type queueMutationError struct {
	kind error
	msg  string
}

func (e *queueMutationError) Error() string {
	return e.msg
}

func (e *queueMutationError) Unwrap() error {
	return e.kind
}

type annotationQueuePauseReason string

const (
	annotationQueuePauseReasonSessionExited  annotationQueuePauseReason = "session-exited-before-finished"
	annotationQueuePauseReasonShutdown       annotationQueuePauseReason = "shutdown"
	annotationQueuePauseReasonUserTerminated annotationQueuePauseReason = "user-terminated"
)

type annotationQueueStatus string

const (
	annotationQueueStatusLaunching annotationQueueStatus = "launching"
	annotationQueueStatusWorking   annotationQueueStatus = "working"
	annotationQueueStatusPaused    annotationQueueStatus = "paused"
)

type annotationQueueEntryState string

const (
	annotationQueueEntryStateActive       annotationQueueEntryState = "active"
	annotationQueueEntryStatePausedActive annotationQueueEntryState = "paused-active"
	annotationQueueEntryStateQueued       annotationQueueEntryState = "queued"
)

type annotationQueueEntrySnapshot struct {
	ActionID   string                    `json:"actionId"`
	Annotation annotationSubmitDetail    `json:"annotation"`
	CreatedAt  int64                     `json:"createdAt"`
	EntryID    string                    `json:"entryId"`
	State      annotationQueueEntryState `json:"state"`
	UpdatedAt  int64                     `json:"updatedAt"`
}

type annotationQueueSnapshot struct {
	ActiveSessionID *string                        `json:"activeSessionId"`
	Entries         []annotationQueueEntrySnapshot `json:"entries"`
	PauseReason     *string                        `json:"pauseReason"`
	QueueID         string                         `json:"queueId"`
	Status          annotationQueueStatus          `json:"status"`
}

type listAnnotationQueuesResponse struct {
	Queues []annotationQueueSnapshot `json:"queues"`
}

type annotationQueuesSnapshotMessage struct {
	Queues []annotationQueueSnapshot `json:"queues"`
	Type   string                    `json:"type"`
}

type resumeAnnotationQueueResponse struct {
	SessionID string `json:"sessionId"`
	Success   bool   `json:"success"`
}

type queueSessionResult struct {
	SessionID string
}

type persistedAnnotationQueueEntry struct {
	ActionID   string                 `json:"actionId,omitempty"`
	Annotation annotationSubmitDetail `json:"annotation"`
	CreatedAt  int64                  `json:"createdAt"`
	EntryID    string                 `json:"entryId"`
	UpdatedAt  int64                  `json:"updatedAt"`
}

type persistedAnnotationQueueRecord struct {
	CurrentEntry   persistedAnnotationQueueEntry   `json:"currentEntry"`
	PauseReason    *annotationQueuePauseReason     `json:"pauseReason"`
	PendingEntries []persistedAnnotationQueueEntry `json:"pendingEntries"`
	QueueID        string                          `json:"queueId"`
}

type persistedAnnotationQueueState struct {
	Queues  []persistedAnnotationQueueRecord `json:"queues"`
	Version int                              `json:"version"`
}

type runtimeAnnotationQueueRecord struct {
	activeSessionID *string
	currentEntry    persistedAnnotationQueueEntry
	pauseReason     *annotationQueuePauseReason
	pendingEntries  []persistedAnnotationQueueEntry
	queueID         string
	status          annotationQueueStatus
}

type liveAgentSessionSnapshot struct {
	actionID    string
	agentStatus *agentSessionStatus
	annotation  annotationSubmitDetail
	sessionID   string
}

type annotationQueueStoreOptions struct {
	manifestPath             string
	onQueuesChanged          func([]annotationQueueSnapshot)
	readLiveAgentSession     func(string) *liveAgentSessionSnapshot
	routedServices           []RoutedServiceIdentity
	stackName                string
	startAgentSession        func(string, annotationSubmitDetail) (string, error)
	stateDirectoryPath       string
	writeAnnotationToSession func(string, string, annotationSubmitDetail) error
}

type annotationQueueStore struct {
	mu                       sync.Mutex
	queueFilePath            string
	queueOrder               []string
	queues                   map[string]*runtimeAnnotationQueueRecord
	onQueuesChanged          func([]annotationQueueSnapshot)
	readLiveAgentSession     func(string) *liveAgentSessionSnapshot
	routedServices           []RoutedServiceIdentity
	startAgentSession        func(string, annotationSubmitDetail) (string, error)
	writeAnnotationToSession func(string, string, annotationSubmitDetail) error
}

func newAnnotationQueueStore(options annotationQueueStoreOptions) *annotationQueueStore {
	queueFilePath := createAnnotationQueueFilePath(options.stateDirectoryPath, options.stackName, options.manifestPath)
	persistedState := loadPersistedAnnotationQueueState(queueFilePath)
	queues := map[string]*runtimeAnnotationQueueRecord{}
	queueOrder := make([]string, 0, len(persistedState.Queues))
	for _, queue := range persistedState.Queues {
		queueRecord := queue
		queues[queue.QueueID] = &runtimeAnnotationQueueRecord{
			activeSessionID: nil,
			currentEntry:    queueRecord.CurrentEntry,
			pauseReason:     queueRecord.PauseReason,
			pendingEntries:  append([]persistedAnnotationQueueEntry{}, queueRecord.PendingEntries...),
			queueID:         queueRecord.QueueID,
			status:          annotationQueueStatusPaused,
		}
		queueOrder = append(queueOrder, queue.QueueID)
	}

	return &annotationQueueStore{
		queueFilePath:            queueFilePath,
		queueOrder:               queueOrder,
		queues:                   queues,
		onQueuesChanged:          options.onQueuesChanged,
		readLiveAgentSession:     options.readLiveAgentSession,
		routedServices:           append([]RoutedServiceIdentity{}, options.routedServices...),
		startAgentSession:        options.startAgentSession,
		writeAnnotationToSession: options.writeAnnotationToSession,
	}
}

func (s *annotationQueueStore) getSnapshot() []annotationQueueSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createSnapshotsLocked()
}

func (s *annotationQueueStore) enqueue(actionID string, annotation annotationSubmitDetail, targetSessionID *string) (queueSessionResult, error) {
	if actionID == "" {
		actionID = defaultAnnotationActionID
	}
	if !isAnnotationSubmitDetail(annotation) {
		return queueSessionResult{}, &queueMutationError{kind: errAnnotationQueueValidation, msg: "Invalid annotation payload."}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var targetLiveSession *liveAgentSessionSnapshot
	if targetSessionID != nil {
		targetLiveSession = s.readLiveAgentSession(*targetSessionID)
	}
	annotationServiceKey := resolveRoutedServiceKeyForAnnotation(s.routedServices, annotation)
	shouldUseTargetSession := shouldUseLiveTargetSession(actionID, annotationServiceKey, targetLiveSession, s.routedServices)

	var targetQueue *runtimeAnnotationQueueRecord
	if targetSessionID != nil && shouldUseTargetSession {
		targetQueue = s.findQueueBySessionIDLocked(*targetSessionID)
	}
	if targetQueue != nil {
		return s.enqueueIntoExistingQueueLocked(targetQueue, actionID, annotation, time.Now().UnixMilli())
	}

	var serviceQueue *runtimeAnnotationQueueRecord
	if annotationServiceKey != nil {
		serviceQueue = s.findQueueByServiceKeyLocked(actionID, annotationServiceKey)
	}
	if serviceQueue != nil {
		return s.enqueueIntoExistingQueueLocked(serviceQueue, actionID, annotation, time.Now().UnixMilli())
	}

	var liveTarget *liveAgentSessionSnapshot
	if shouldUseTargetSession {
		liveTarget = targetLiveSession
	}
	timestamp := time.Now().UnixMilli()
	queue := createRuntimeQueueForEnqueue(actionID, annotation, timestamp, liveTarget)
	s.queues[queue.queueID] = queue
	s.queueOrder = append(s.queueOrder, queue.queueID)
	if err := s.persistLocked(); err != nil {
		s.deleteQueueLocked(queue.queueID)
		return queueSessionResult{}, err
	}

	sessionID, err := s.dispatchQueueHeadLocked(queue, liveTarget)
	if err != nil {
		queue.activeSessionID = nil
		pauseReason := annotationQueuePauseReasonSessionExited
		queue.pauseReason = &pauseReason
		queue.status = annotationQueueStatusPaused
		persistErr := s.persistLocked()
		s.publishLocked()
		return queueSessionResult{}, errors.Join(err, persistErr)
	}

	s.publishLocked()
	return queueSessionResult{SessionID: sessionID}, nil
}

func (s *annotationQueueStore) handleAgentStatus(sessionID string, status agentSessionStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.findQueueBySessionIDLocked(sessionID)
	if queue == nil {
		return nil
	}

	if status == agentSessionStatusWorking {
		if queue.status != annotationQueueStatusWorking {
			queue.status = annotationQueueStatusWorking
			if err := s.persistLocked(); err != nil {
				return err
			}
			s.publishLocked()
		}
		return nil
	}

	if len(queue.pendingEntries) == 0 {
		s.deleteQueueLocked(queue.queueID)
		if err := s.persistLocked(); err != nil {
			return err
		}
		s.publishLocked()
		return nil
	}

	nextEntry := queue.pendingEntries[0]
	queue.pendingEntries = append([]persistedAnnotationQueueEntry{}, queue.pendingEntries[1:]...)
	queue.currentEntry = nextEntry
	queue.pauseReason = nil
	if err := s.persistLocked(); err != nil {
		return err
	}

	_, err := s.dispatchQueueHeadLocked(queue, s.readLiveAgentSession(sessionID))
	if err != nil {
		queue.activeSessionID = nil
		pauseReason := annotationQueuePauseReasonSessionExited
		queue.pauseReason = &pauseReason
		queue.status = annotationQueueStatusPaused
		persistErr := s.persistLocked()
		s.publishLocked()
		return errors.Join(err, persistErr)
	}

	s.publishLocked()
	return nil
}

func (s *annotationQueueStore) handleSessionExited(sessionID string) error {
	return s.pauseQueueForSession(sessionID, annotationQueuePauseReasonSessionExited)
}

func (s *annotationQueueStore) handleUserClosedSession(sessionID string) error {
	return s.pauseQueueForSession(sessionID, annotationQueuePauseReasonUserTerminated)
}

func (s *annotationQueueStore) prepareForShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	hasChanges := false
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue == nil || queue.activeSessionID == nil {
			continue
		}
		queue.activeSessionID = nil
		pauseReason := annotationQueuePauseReasonShutdown
		queue.pauseReason = &pauseReason
		queue.status = annotationQueueStatusPaused
		hasChanges = true
	}
	if !hasChanges {
		return nil
	}
	return s.persistLocked()
}

func (s *annotationQueueStore) resumePersistedQueues() error {
	s.mu.Lock()
	queueIDs := append([]string{}, s.queueOrder...)
	s.mu.Unlock()

	for _, queueID := range queueIDs {
		if _, err := s.resumePersistedQueue(queueID); err != nil {
			return err
		}
	}
	return nil
}

func (s *annotationQueueStore) resumePersistedQueue(queueID string) (queueSessionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.queues[queueID]
	if queue == nil {
		return queueSessionResult{}, nil
	}
	if queue.pauseReason != nil && *queue.pauseReason == annotationQueuePauseReasonUserTerminated {
		return queueSessionResult{}, nil
	}

	previousPauseReason := queue.pauseReason
	queue.pauseReason = nil
	if err := s.persistLocked(); err != nil {
		queue.pauseReason = previousPauseReason
		return queueSessionResult{}, err
	}

	sessionID, err := s.dispatchQueueHeadLocked(queue, nil)
	if err != nil {
		queue.activeSessionID = nil
		if previousPauseReason == nil {
			pauseReason := annotationQueuePauseReasonSessionExited
			queue.pauseReason = &pauseReason
		} else {
			queue.pauseReason = previousPauseReason
		}
		queue.status = annotationQueueStatusPaused
		persistErr := s.persistLocked()
		s.publishLocked()
		return queueSessionResult{}, errors.Join(err, persistErr)
	}

	s.publishLocked()
	return queueSessionResult{SessionID: sessionID}, nil
}

func (s *annotationQueueStore) resumeQueue(queueID string) (queueSessionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.queues[queueID]
	if queue == nil {
		return queueSessionResult{}, &queueMutationError{kind: errAnnotationQueueNotFound, msg: "Queue was not found."}
	}
	if queue.status != annotationQueueStatusPaused {
		return queueSessionResult{}, &queueMutationError{kind: errAnnotationQueueConflict, msg: "Queue is not paused."}
	}

	previousPauseReason := queue.pauseReason
	queue.pauseReason = nil
	if err := s.persistLocked(); err != nil {
		queue.pauseReason = previousPauseReason
		return queueSessionResult{}, err
	}

	sessionID, err := s.dispatchQueueHeadLocked(queue, nil)
	if err != nil {
		queue.activeSessionID = nil
		queue.pauseReason = previousPauseReason
		queue.status = annotationQueueStatusPaused
		persistErr := s.persistLocked()
		s.publishLocked()
		return queueSessionResult{}, errors.Join(err, persistErr)
	}

	s.publishLocked()
	return queueSessionResult{SessionID: sessionID}, nil
}

func (s *annotationQueueStore) updateEntryComment(entryID string, comment string) error {
	if strings.TrimSpace(comment) == "" {
		return &queueMutationError{kind: errAnnotationQueueValidation, msg: "Queue entry comments must not be blank."}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	locatedQueue, entry, entryState, pendingIndex := s.locateQueueEntryLocked(entryID)
	if locatedQueue == nil || entry == nil {
		return &queueMutationError{kind: errAnnotationQueueNotFound, msg: "Queue entry was not found."}
	}
	if entryState == annotationQueueEntryStateActive {
		return &queueMutationError{kind: errAnnotationQueueConflict, msg: "Active queue entries cannot be edited."}
	}

	entry.Annotation.Comment = comment
	entry.UpdatedAt = time.Now().UnixMilli()
	if pendingIndex >= 0 {
		locatedQueue.pendingEntries[pendingIndex] = *entry
	} else {
		locatedQueue.currentEntry = *entry
	}
	if err := s.persistLocked(); err != nil {
		return err
	}
	s.publishLocked()
	return nil
}

func (s *annotationQueueStore) deleteEntry(entryID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue, _, entryState, pendingIndex := s.locateQueueEntryLocked(entryID)
	if queue == nil {
		return &queueMutationError{kind: errAnnotationQueueNotFound, msg: "Queue entry was not found."}
	}
	if entryState == annotationQueueEntryStateActive {
		return &queueMutationError{kind: errAnnotationQueueConflict, msg: "Active queue entries cannot be removed."}
	}

	if entryState == annotationQueueEntryStateQueued {
		queue.pendingEntries = append(append([]persistedAnnotationQueueEntry{}, queue.pendingEntries[:pendingIndex]...), queue.pendingEntries[pendingIndex+1:]...)
	} else if len(queue.pendingEntries) > 0 {
		queue.currentEntry = queue.pendingEntries[0]
		queue.pendingEntries = append([]persistedAnnotationQueueEntry{}, queue.pendingEntries[1:]...)
	} else {
		s.deleteQueueLocked(queue.queueID)
	}

	if err := s.persistLocked(); err != nil {
		return err
	}
	s.publishLocked()
	return nil
}

func (s *annotationQueueStore) enqueueIntoExistingQueueLocked(queue *runtimeAnnotationQueueRecord, actionID string, annotation annotationSubmitDetail, timestamp int64) (queueSessionResult, error) {
	queue.pendingEntries = append(queue.pendingEntries, createPersistedQueueEntry(actionID, annotation, timestamp))
	if err := s.persistLocked(); err != nil {
		return queueSessionResult{}, err
	}

	if queue.status != annotationQueueStatusPaused && queue.activeSessionID != nil {
		s.publishLocked()
		return queueSessionResult{SessionID: *queue.activeSessionID}, nil
	}

	previousPauseReason := queue.pauseReason
	sessionID, err := s.dispatchQueueHeadLocked(queue, nil)
	if err != nil {
		queue.activeSessionID = nil
		if previousPauseReason == nil {
			pauseReason := annotationQueuePauseReasonSessionExited
			queue.pauseReason = &pauseReason
		} else {
			queue.pauseReason = previousPauseReason
		}
		queue.status = annotationQueueStatusPaused
		persistErr := s.persistLocked()
		s.publishLocked()
		return queueSessionResult{}, errors.Join(err, persistErr)
	}

	s.publishLocked()
	return queueSessionResult{SessionID: sessionID}, nil
}

func (s *annotationQueueStore) dispatchQueueHeadLocked(queue *runtimeAnnotationQueueRecord, preferredSession *liveAgentSessionSnapshot) (string, error) {
	queue.pauseReason = nil
	queue.status = annotationQueueStatusLaunching
	if err := s.persistLocked(); err != nil {
		return "", err
	}

	activeSession := readDispatchTargetSession(queue.activeSessionID, preferredSession, s.readLiveAgentSession)
	if activeSession != nil {
		if err := s.writeAnnotationToSession(queue.currentEntry.ActionID, activeSession.sessionID, queue.currentEntry.Annotation); err != nil {
			return "", err
		}
		queue.activeSessionID = stringPointer(activeSession.sessionID)
		return activeSession.sessionID, nil
	}

	sessionID, err := s.startAgentSession(queue.currentEntry.ActionID, queue.currentEntry.Annotation)
	if err != nil {
		return "", err
	}
	queue.activeSessionID = stringPointer(sessionID)
	return sessionID, nil
}

func (s *annotationQueueStore) pauseQueueForSession(sessionID string, pauseReason annotationQueuePauseReason) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.findQueueBySessionIDLocked(sessionID)
	if queue == nil {
		return nil
	}
	queue.activeSessionID = nil
	queue.pauseReason = &pauseReason
	queue.status = annotationQueueStatusPaused
	if err := s.persistLocked(); err != nil {
		return err
	}
	s.publishLocked()
	return nil
}

func (s *annotationQueueStore) createSnapshotsLocked() []annotationQueueSnapshot {
	queues := make([]annotationQueueSnapshot, 0, len(s.queueOrder))
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue == nil {
			continue
		}
		entries := []annotationQueueEntrySnapshot{{
			ActionID:   queue.currentEntry.ActionID,
			Annotation: queue.currentEntry.Annotation,
			CreatedAt:  queue.currentEntry.CreatedAt,
			EntryID:    queue.currentEntry.EntryID,
			State:      activeQueueEntryState(queue.status),
			UpdatedAt:  queue.currentEntry.UpdatedAt,
		}}
		for _, entry := range queue.pendingEntries {
			entries = append(entries, annotationQueueEntrySnapshot{
				ActionID:   entry.ActionID,
				Annotation: entry.Annotation,
				CreatedAt:  entry.CreatedAt,
				EntryID:    entry.EntryID,
				State:      annotationQueueEntryStateQueued,
				UpdatedAt:  entry.UpdatedAt,
			})
		}
		queues = append(queues, annotationQueueSnapshot{
			ActiveSessionID: queue.activeSessionID,
			Entries:         entries,
			PauseReason:     publicPauseReason(queue.pauseReason),
			QueueID:         queue.queueID,
			Status:          queue.status,
		})
	}
	return queues
}

func (s *annotationQueueStore) publishLocked() {
	if s.onQueuesChanged == nil {
		return
	}
	s.onQueuesChanged(s.createSnapshotsLocked())
}

func (s *annotationQueueStore) persistLocked() error {
	if len(s.queueOrder) == 0 {
		if err := removeFileDurably(s.queueFilePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove annotation queue state: %w", err)
		}
		return nil
	}

	persistedState := persistedAnnotationQueueState{Queues: make([]persistedAnnotationQueueRecord, 0, len(s.queueOrder)), Version: annotationQueuesVersion}
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue == nil {
			continue
		}
		persistedState.Queues = append(persistedState.Queues, persistedAnnotationQueueRecord{
			CurrentEntry:   queue.currentEntry,
			PauseReason:    queue.pauseReason,
			PendingEntries: append([]persistedAnnotationQueueEntry{}, queue.pendingEntries...),
			QueueID:        queue.queueID,
		})
	}

	payload, err := json.MarshalIndent(persistedState, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal annotation queue state: %w", err)
	}
	if err := writeFileDurably(s.queueFilePath, payload, 0o600); err != nil {
		return fmt.Errorf("write annotation queue state: %w", err)
	}
	return nil
}

func (s *annotationQueueStore) locateQueueEntryLocked(entryID string) (*runtimeAnnotationQueueRecord, *persistedAnnotationQueueEntry, annotationQueueEntryState, int) {
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue == nil {
			continue
		}
		if queue.currentEntry.EntryID == entryID {
			entry := queue.currentEntry
			return queue, &entry, activeQueueEntryState(queue.status), -1
		}
		for index := range queue.pendingEntries {
			if queue.pendingEntries[index].EntryID == entryID {
				entry := queue.pendingEntries[index]
				return queue, &entry, annotationQueueEntryStateQueued, index
			}
		}
	}
	return nil, nil, "", -1
}

func (s *annotationQueueStore) findQueueBySessionIDLocked(sessionID string) *runtimeAnnotationQueueRecord {
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue != nil && queue.activeSessionID != nil && *queue.activeSessionID == sessionID {
			return queue
		}
	}
	return nil
}

func (s *annotationQueueStore) findQueueByServiceKeyLocked(actionID string, serviceKey *string) *runtimeAnnotationQueueRecord {
	var pausedMatch *runtimeAnnotationQueueRecord
	for _, queueID := range s.queueOrder {
		queue := s.queues[queueID]
		if queue == nil || queue.currentEntry.ActionID != actionID || !sameOptionalString(resolveRoutedServiceKeyForAnnotation(s.routedServices, queue.currentEntry.Annotation), serviceKey) {
			continue
		}
		if queue.status != annotationQueueStatusPaused {
			return queue
		}
		if pausedMatch == nil {
			pausedMatch = queue
		}
	}
	return pausedMatch
}

func (s *annotationQueueStore) deleteQueueLocked(queueID string) {
	delete(s.queues, queueID)
	for index, currentID := range s.queueOrder {
		if currentID == queueID {
			s.queueOrder = append(s.queueOrder[:index], s.queueOrder[index+1:]...)
			return
		}
	}
}

func createRuntimeQueueForEnqueue(actionID string, annotation annotationSubmitDetail, timestamp int64, liveTargetSession *liveAgentSessionSnapshot) *runtimeAnnotationQueueRecord {
	if liveTargetSession == nil {
		return createRuntimeQueueRecord(createPersistedQueueEntry(actionID, annotation, timestamp))
	}
	if liveTargetSession.agentStatus != nil && *liveTargetSession.agentStatus == agentSessionStatusFinished {
		queue := createRuntimeQueueRecord(createPersistedQueueEntry(actionID, annotation, timestamp))
		queue.activeSessionID = stringPointer(liveTargetSession.sessionID)
		queue.status = annotationQueueStatusLaunching
		return queue
	}

	status := annotationQueueStatusLaunching
	if liveTargetSession.agentStatus != nil && *liveTargetSession.agentStatus == agentSessionStatusWorking {
		status = annotationQueueStatusWorking
	}

	return &runtimeAnnotationQueueRecord{
		activeSessionID: stringPointer(liveTargetSession.sessionID),
		currentEntry:    createPersistedQueueEntry(liveTargetSession.actionID, liveTargetSession.annotation, liveTargetSession.annotation.SubmittedAt),
		pendingEntries:  []persistedAnnotationQueueEntry{createPersistedQueueEntry(actionID, annotation, timestamp)},
		queueID:         mustCreateID(),
		status:          status,
	}
}

func createRuntimeQueueRecord(currentEntry persistedAnnotationQueueEntry) *runtimeAnnotationQueueRecord {
	return &runtimeAnnotationQueueRecord{
		currentEntry:   currentEntry,
		pendingEntries: []persistedAnnotationQueueEntry{},
		queueID:        mustCreateID(),
		status:         annotationQueueStatusLaunching,
	}
}

func createPersistedQueueEntry(actionID string, annotation annotationSubmitDetail, timestamp int64) persistedAnnotationQueueEntry {
	if actionID == "" {
		actionID = defaultAnnotationActionID
	}
	return persistedAnnotationQueueEntry{
		ActionID:   actionID,
		Annotation: annotation,
		CreatedAt:  timestamp,
		EntryID:    mustCreateID(),
		UpdatedAt:  timestamp,
	}
}

func activeQueueEntryState(status annotationQueueStatus) annotationQueueEntryState {
	if status == annotationQueueStatusPaused {
		return annotationQueueEntryStatePausedActive
	}
	return annotationQueueEntryStateActive
}

func publicPauseReason(pauseReason *annotationQueuePauseReason) *string {
	if pauseReason == nil {
		return nil
	}
	if *pauseReason != annotationQueuePauseReasonSessionExited && *pauseReason != annotationQueuePauseReasonUserTerminated {
		return nil
	}
	value := string(*pauseReason)
	return &value
}

func createAnnotationQueueSnapshotMessage(queues []annotationQueueSnapshot) annotationQueuesSnapshotMessage {
	return annotationQueuesSnapshotMessage{Queues: queues, Type: "snapshot"}
}

func createAnnotationQueueFilePath(stateDirectoryPath string, stackName string, manifestPath string) string {
	fileName := fmt.Sprintf("%s-%s.json", sanitizeFileSegment(stackName), shortManifestHash(manifestPath))
	return filepath.Join(stateDirectoryPath, "devtools", annotationQueuesDirectoryName, fileName)
}

func sanitizeFileSegment(value string) string {
	if value == "" {
		return "devhost"
	}
	builder := strings.Builder{}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			builder.WriteRune(r)
			continue
		}
		builder.WriteByte('-')
	}
	return builder.String()
}

func shortManifestHash(manifestPath string) string {
	hash := sha256.Sum256([]byte(manifestPath))
	return hex.EncodeToString(hash[:])[:12]
}

func loadPersistedAnnotationQueueState(queueFilePath string) persistedAnnotationQueueState {
	payload, err := os.ReadFile(queueFilePath)
	if err != nil {
		return persistedAnnotationQueueState{Queues: []persistedAnnotationQueueRecord{}, Version: annotationQueuesVersion}
	}

	var raw struct {
		Queues  []json.RawMessage `json:"queues"`
		Version int               `json:"version"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil || (raw.Version != 1 && raw.Version != annotationQueuesVersion) {
		moveCorruptQueueFile(queueFilePath)
		return persistedAnnotationQueueState{Queues: []persistedAnnotationQueueRecord{}, Version: annotationQueuesVersion}
	}

	repairedQueues := []persistedAnnotationQueueRecord{}
	for _, queuePayload := range raw.Queues {
		queue := repairPersistedQueueRecord(queuePayload)
		if queue != nil {
			repairedQueues = append(repairedQueues, *queue)
		}
	}
	return persistedAnnotationQueueState{Queues: repairedQueues, Version: annotationQueuesVersion}
}

func repairPersistedQueueRecord(payload []byte) *persistedAnnotationQueueRecord {
	var raw struct {
		CurrentEntry   json.RawMessage   `json:"currentEntry"`
		PauseReason    *string           `json:"pauseReason"`
		PendingEntries []json.RawMessage `json:"pendingEntries"`
		QueueID        string            `json:"queueId"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil || raw.QueueID == "" {
		return nil
	}
	if raw.PauseReason != nil && !isPersistedPauseReason(*raw.PauseReason) {
		return nil
	}

	repairedPendingEntries := []persistedAnnotationQueueEntry{}
	for _, entryPayload := range raw.PendingEntries {
		entry := repairPersistedQueueEntry(entryPayload)
		if entry != nil {
			repairedPendingEntries = append(repairedPendingEntries, *entry)
		}
	}
	repairedCurrentEntry := repairPersistedQueueEntry(raw.CurrentEntry)
	if repairedCurrentEntry == nil {
		if len(repairedPendingEntries) == 0 {
			return nil
		}
		head := repairedPendingEntries[0]
		repairedPendingEntries = append([]persistedAnnotationQueueEntry{}, repairedPendingEntries[1:]...)
		repairedCurrentEntry = &head
	}

	var pauseReason *annotationQueuePauseReason
	if raw.PauseReason != nil {
		value := annotationQueuePauseReason(*raw.PauseReason)
		pauseReason = &value
	}
	return &persistedAnnotationQueueRecord{
		CurrentEntry:   *repairedCurrentEntry,
		PauseReason:    pauseReason,
		PendingEntries: repairedPendingEntries,
		QueueID:        raw.QueueID,
	}
}

func repairPersistedQueueEntry(payload []byte) *persistedAnnotationQueueEntry {
	var entry persistedAnnotationQueueEntry
	if err := json.Unmarshal(payload, &entry); err != nil || entry.EntryID == "" || !isAnnotationSubmitDetail(entry.Annotation) {
		return nil
	}
	if entry.ActionID == "" {
		entry.ActionID = defaultAnnotationActionID
	}
	return &entry
}

func isPersistedPauseReason(value string) bool {
	return value == string(annotationQueuePauseReasonSessionExited) || value == string(annotationQueuePauseReasonShutdown) || value == string(annotationQueuePauseReasonUserTerminated)
}

func moveCorruptQueueFile(queueFilePath string) {
	corruptPath := strings.TrimSuffix(queueFilePath, filepath.Ext(queueFilePath)) + ".corrupt-" + fmt.Sprintf("%d", time.Now().UnixMilli()) + ".json"
	_ = os.Rename(queueFilePath, corruptPath)
}

func writeFileDurably(filePath string, payload []byte, mode os.FileMode) error {
	directoryPath := filepath.Dir(filePath)
	if err := os.MkdirAll(directoryPath, 0o700); err != nil {
		return err
	}
	temporaryPath := filePath + "." + mustCreateID() + ".tmp"
	file, err := annotationQueueOpenFile(temporaryPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := annotationQueueSyncFile(file); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := annotationQueueRenameFile(temporaryPath, filePath); err != nil {
		return err
	}
	return annotationQueueSyncDirectory(directoryPath)
}

func removeFileDurably(filePath string) error {
	if err := annotationQueueRemoveFile(filePath); err != nil {
		return err
	}
	return annotationQueueSyncDirectory(filepath.Dir(filePath))
}

func syncDirectory(directoryPath string) error {
	directory, err := os.Open(directoryPath)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func readDispatchTargetSession(activeSessionID *string, preferredSession *liveAgentSessionSnapshot, readLiveAgentSession func(string) *liveAgentSessionSnapshot) *liveAgentSessionSnapshot {
	if preferredSession != nil && activeSessionID != nil && preferredSession.sessionID == *activeSessionID {
		return preferredSession
	}
	if activeSessionID == nil {
		return nil
	}
	return readLiveAgentSession(*activeSessionID)
}

func shouldUseLiveTargetSession(actionID string, annotationServiceKey *string, targetLiveSession *liveAgentSessionSnapshot, routedServices []RoutedServiceIdentity) bool {
	if targetLiveSession != nil && targetLiveSession.actionID != actionID {
		return false
	}
	if annotationServiceKey == nil || targetLiveSession == nil {
		return true
	}
	targetServiceKey := resolveRoutedServiceKeyForAnnotation(routedServices, targetLiveSession.annotation)
	return targetServiceKey == nil || sameOptionalString(targetServiceKey, annotationServiceKey)
}

func resolveRoutedServiceKeyForAnnotation(routedServices []RoutedServiceIdentity, annotation annotationSubmitDetail) *string {
	service := resolveRoutedServiceForURL(routedServices, annotation.URL)
	if service == nil {
		return nil
	}
	value := strings.ToLower(service.Host) + "|" + normalizeRoutedServicePath(service.Path)
	return &value
}

func resolveRoutedServiceForURL(routedServices []RoutedServiceIdentity, urlText string) *RoutedServiceIdentity {
	parsedURL, err := url.Parse(urlText)
	if err != nil || parsedURL.Hostname() == "" {
		return nil
	}

	var bestMatch *RoutedServiceIdentity
	bestMatchWeight := -1 << 30
	for index := range routedServices {
		service := routedServices[index]
		if strings.ToLower(service.Host) != strings.ToLower(parsedURL.Hostname()) {
			continue
		}
		normalizedPath := normalizeRoutedServicePath(service.Path)
		if !doesRoutedServiceMatchPath(normalizedPath, parsedURL.Path) {
			continue
		}
		matchWeight := routedServicePathWeight(normalizedPath)
		if bestMatch == nil || matchWeight > bestMatchWeight || (matchWeight == bestMatchWeight && service.ServiceName < bestMatch.ServiceName) {
			candidate := service
			bestMatch = &candidate
			bestMatchWeight = matchWeight
		}
	}
	return bestMatch
}

func normalizeRoutedServicePath(path string) string {
	if path == "" || path == "/" || path == "/*" {
		return "/"
	}
	return path
}

func doesRoutedServiceMatchPath(routePath string, pathname string) bool {
	if routePath == "/" {
		return true
	}
	if strings.HasSuffix(routePath, "/*") {
		basePath := strings.TrimSuffix(routePath, "/*")
		return strings.HasPrefix(pathname, basePath+"/")
	}
	return pathname == routePath
}

func routedServicePathWeight(path string) int {
	if path == "/" {
		return -1
	}
	if strings.HasSuffix(path, "/*") {
		return len(strings.TrimSuffix(path, "/*")) * 10
	}
	return len(path)*10 + 1
}

func sameOptionalString(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func stringPointer(value string) *string {
	result := value
	return &result
}

func mustCreateID() string {
	value, err := createControlToken()
	if err == nil {
		return value
	}
	return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
}

func isAnnotationSubmitDetail(value annotationSubmitDetail) bool {
	for _, marker := range value.Markers {
		if !isAnnotationMarkerPayload(marker) {
			return false
		}
	}
	return true
}

func isAnnotationMarkerPayload(value annotationMarkerPayload) bool {
	if value.ComputedStylesOb == nil {
		return false
	}
	if value.MarkerNumber == 0 {
		return false
	}
	return true
}
