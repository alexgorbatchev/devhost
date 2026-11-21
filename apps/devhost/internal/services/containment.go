package services

import (
	"maps"
	"os"
	"os/exec"
	"sort"
	"sync"
	"syscall"
	"time"
)

const (
	processTreePollInterval            = 200 * time.Millisecond
	shutdownPollInterval               = 10 * time.Millisecond
	serviceContainmentTokenEnvironment = "DEVHOST_SERVICE_TOKEN"
)

var sharedProcessTreeMonitor = newProcessTreeMonitor(processTreePollInterval, readProcessSnapshot)

type serviceContainment struct {
	rootPID      int
	serviceToken string
	tracker      *processTreeTracker
}

// processRecord is what a reading of the process table holds about one process.
type processRecord struct {
	parentPID int
	// startIdentity tells this process from a later one given the same PID (see internal/procid). It is empty on a
	// platform without one, where a PID is taken to name the same process for as long as some process has it.
	startIdentity string
	// exited marks a zombie: a process that has exited and waits for its parent to collect it. It runs no more, and
	// its PID is not given to another process until it is collected.
	exited bool
}

// processSnapshot is one reading of the whole process table.
type processSnapshot struct {
	processes        map[int]processRecord
	childrenByParent map[int][]int
}

type processSnapshotReader func() (processSnapshot, error)

type processTreeMonitor struct {
	pollInterval time.Duration
	readSnapshot processSnapshotReader

	closeOnce sync.Once
	done      chan struct{}
	mu        sync.Mutex
	refreshMu sync.Mutex
	trackers  map[*processTreeTracker]struct{}
	wg        sync.WaitGroup
}

// processTreeTracker follows the processes of one service: those a snapshot lists under its root process, and on
// Linux those that carry its containment token. A PID names a process only while it runs, and the system gives it to
// another process later, so the tracker records each process with its start identity and signals a PID only while
// the process that has it still has that identity.
type processTreeTracker struct {
	rootPID int
	// rootIdentity is the start identity the root process had when its tracker started. Once the root has exited, a
	// later process given its PID belongs to something else, and so do that process's children.
	rootIdentity string
	serviceToken string
	monitor      *processTreeMonitor

	closeOnce sync.Once
	mu        sync.Mutex
	// tracked holds each process a snapshot has listed in the service's tree, by PID, with the start identity it had
	// then. It keeps a process that has left the tree, such as a daemon that launchd adopted when its parent exited,
	// for as long as that process runs, and drops the entry once the PID is free or names a later process.
	tracked map[int]string
}

func newProcessSnapshot() processSnapshot {
	return processSnapshot{processes: map[int]processRecord{}, childrenByParent: map[int][]int{}}
}

func (s processSnapshot) add(pid int, process processRecord) {
	s.processes[pid] = process
	s.childrenByParent[process.parentPID] = append(s.childrenByParent[process.parentPID], pid)
}

func newProcessTreeMonitor(pollInterval time.Duration, readSnapshot processSnapshotReader) *processTreeMonitor {
	monitor := &processTreeMonitor{
		pollInterval: pollInterval,
		readSnapshot: readSnapshot,
		done:         make(chan struct{}),
		trackers:     map[*processTreeTracker]struct{}{},
	}

	monitor.wg.Add(1)
	go monitor.run()

	return monitor
}

func startServiceContainment(rootPID int, serviceToken string) (*serviceContainment, error) {
	if err := prepareServiceContainment(); err != nil {
		return nil, err
	}

	tracker, err := sharedProcessTreeMonitor.startTracker(rootPID, serviceToken)
	if err != nil {
		return nil, err
	}

	return &serviceContainment{rootPID: rootPID, serviceToken: serviceToken, tracker: tracker}, nil
}

func (c *serviceContainment) close() {
	if c == nil || c.tracker == nil {
		return
	}

	c.tracker.close()
}

func (c *serviceContainment) hasLiveDescendants() bool {
	if c == nil || c.tracker == nil {
		return false
	}

	return len(c.tracker.liveDescendantPIDs()) > 0
}

func (c *serviceContainment) signal(command *exec.Cmd, includeRootProcessGroup bool, signal os.Signal) {
	if c == nil {
		if includeRootProcessGroup {
			serviceSignalSender(command, signal)
		}
		return
	}

	_ = c.tracker.refresh()
	if includeRootProcessGroup {
		serviceSignalSender(command, signal)
	}
	c.signalTrackedDescendants(signal)
}

func (c *serviceContainment) signalTrackedDescendants(signal os.Signal) {
	signalValue, ok := signal.(syscall.Signal)
	if !ok {
		return
	}

	for pid, identity := range c.tracker.trackedProcesses() {
		signalTrackedProcess(pid, identity, signalValue)
	}
}

// signalTrackedProcess sends signal to pid only while it names the process that was tracked with identity. The
// identity is read again right before the signal: the process may have exited since the snapshot that listed it last,
// and the system then gives its PID to an unrelated process.
func signalTrackedProcess(pid int, identity string, signal syscall.Signal) {
	if !processMatches(pid, identity) {
		return
	}

	// The process has just exited, or devhost may not signal it. Either way the shutdown checks it again, and reports
	// it if it keeps running.
	_ = syscall.Kill(pid, signal)
}

// processMatches reports whether pid still names the process that had identity, and that process has not exited.
// A process that cannot be read is not one devhost can verify, so it matches nothing.
func processMatches(pid int, identity string) bool {
	if pid <= 0 {
		return false
	}

	process, ok := readProcessRecord(pid)
	return ok && !process.exited && process.startIdentity == identity
}

func (m *processTreeMonitor) close() {
	m.closeOnce.Do(func() {
		close(m.done)
		m.wg.Wait()
	})
}

func (m *processTreeMonitor) startTracker(rootPID int, serviceToken string) (*processTreeTracker, error) {
	m.refreshMu.Lock()
	snapshot, err := m.readSnapshot()
	if err != nil {
		m.refreshMu.Unlock()
		return nil, err
	}

	// The root is a child of this process that is collected only after its tracker has started, so the table lists
	// it with the identity it started with, even when it has already exited.
	tracker := &processTreeTracker{
		rootPID:      rootPID,
		rootIdentity: snapshot.processes[rootPID].startIdentity,
		serviceToken: serviceToken,
		monitor:      m,
		tracked:      map[int]string{},
	}
	tracker.applySnapshot(snapshot)
	m.refreshMu.Unlock()

	m.mu.Lock()
	m.trackers[tracker] = struct{}{}
	m.mu.Unlock()

	return tracker, nil
}

func (m *processTreeMonitor) unregisterTracker(tracker *processTreeTracker) {
	m.mu.Lock()
	delete(m.trackers, tracker)
	m.mu.Unlock()
}

func (m *processTreeMonitor) refreshTracker(tracker *processTreeTracker) error {
	if tracker == nil {
		return nil
	}

	return m.refreshTrackersBySet([]*processTreeTracker{tracker})
}

func (m *processTreeMonitor) refreshTrackers() error {
	m.mu.Lock()
	trackers := make([]*processTreeTracker, 0, len(m.trackers))
	for tracker := range m.trackers {
		trackers = append(trackers, tracker)
	}
	m.mu.Unlock()

	return m.refreshTrackersBySet(trackers)
}

func (m *processTreeMonitor) refreshTrackersBySet(trackers []*processTreeTracker) error {
	if len(trackers) == 0 {
		return nil
	}

	m.refreshMu.Lock()
	defer m.refreshMu.Unlock()

	snapshot, err := m.readSnapshot()
	if err != nil {
		return err
	}

	for _, tracker := range trackers {
		tracker.applySnapshot(snapshot)
	}

	return nil
}

func (m *processTreeMonitor) run() {
	defer m.wg.Done()

	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.done:
			return
		case <-ticker.C:
			_ = m.refreshTrackers()
		}
	}
}

func (t *processTreeTracker) close() {
	t.closeOnce.Do(func() {
		if t.monitor != nil {
			t.monitor.unregisterTracker(t)
		}
	})
}

// liveDescendantPIDs refreshes the tracker and returns the tracked processes that still run. It reads each one again,
// because the refresh can fail and a process can exit after it.
func (t *processTreeTracker) liveDescendantPIDs() []int {
	_ = t.refresh()

	t.mu.Lock()
	defer t.mu.Unlock()

	live := make([]int, 0, len(t.tracked))
	for pid, identity := range t.tracked {
		if !processMatches(pid, identity) {
			delete(t.tracked, pid)
			continue
		}
		live = append(live, pid)
	}

	sort.Ints(live)
	return live
}

// trackedProcesses returns a copy of the tracked processes: each PID with the start identity it was tracked with.
func (t *processTreeTracker) trackedProcesses() map[int]string {
	t.mu.Lock()
	defer t.mu.Unlock()

	return maps.Clone(t.tracked)
}

func (t *processTreeTracker) refresh() error {
	if t == nil || t.monitor == nil {
		return nil
	}

	return t.monitor.refreshTracker(t)
}

// applySnapshot tracks every process the snapshot lists in the service's tree, and drops each tracked process the
// snapshot shows has gone: its PID is no longer listed, is listed as exited, or names a process that started later.
func (t *processTreeTracker) applySnapshot(snapshot processSnapshot) {
	descendants := []int{}
	if root, ok := snapshot.processes[t.rootPID]; ok && root.startIdentity == t.rootIdentity {
		descendants = collectDescendantPIDs(snapshot.childrenByParent, t.rootPID)
	}
	for _, pid := range collectPlatformContainmentRootPIDs(snapshot.childrenByParent, t.serviceToken) {
		descendants = append(descendants, pid)
		descendants = append(descendants, collectDescendantPIDs(snapshot.childrenByParent, pid)...)
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	for _, pid := range descendants {
		identity := snapshot.processes[pid].startIdentity
		if pid == t.rootPID && identity == t.rootIdentity {
			// The root is signalled through its process group, and its exit is read from its exit status.
			continue
		}
		t.tracked[pid] = identity
	}

	for pid, identity := range t.tracked {
		if process, ok := snapshot.processes[pid]; !ok || process.exited || process.startIdentity != identity {
			delete(t.tracked, pid)
		}
	}
}

func collectDescendantPIDs(childrenByParent map[int][]int, rootPID int) []int {
	queue := append([]int{}, childrenByParent[rootPID]...)
	seen := map[int]struct{}{}
	descendants := []int{}

	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		if _, ok := seen[pid]; ok {
			continue
		}
		seen[pid] = struct{}{}
		descendants = append(descendants, pid)
		queue = append(queue, childrenByParent[pid]...)
	}

	return descendants
}

func processExists(pid int) bool {
	return processIsLive(pid)
}

func processExistsBySignal(pid int) bool {
	if pid <= 0 {
		return false
	}

	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
