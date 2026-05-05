package services

import (
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

type processSnapshotReader func() (map[int][]int, error)

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

type processTreeTracker struct {
	rootPID      int
	serviceToken string
	monitor      *processTreeMonitor

	closeOnce sync.Once
	mu        sync.Mutex
	tracked   map[int]struct{}
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

	for _, pid := range c.tracker.liveDescendantPIDs() {
		if err := syscall.Kill(pid, signalValue); err != nil && err != syscall.ESRCH {
			continue
		}
	}
}

func (m *processTreeMonitor) close() {
	m.closeOnce.Do(func() {
		close(m.done)
		m.wg.Wait()
	})
}

func (m *processTreeMonitor) startTracker(rootPID int, serviceToken string) (*processTreeTracker, error) {
	tracker := &processTreeTracker{
		rootPID:      rootPID,
		serviceToken: serviceToken,
		monitor:      m,
		tracked:      map[int]struct{}{},
	}

	m.mu.Lock()
	m.trackers[tracker] = struct{}{}
	m.mu.Unlock()

	if err := m.refreshTracker(tracker); err != nil {
		m.unregisterTracker(tracker)
		return nil, err
	}

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

	childrenByParent, err := m.readSnapshot()
	if err != nil {
		return err
	}

	for _, tracker := range trackers {
		tracker.applySnapshot(childrenByParent)
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

func (t *processTreeTracker) liveDescendantPIDs() []int {
	_ = t.refresh()

	t.mu.Lock()
	defer t.mu.Unlock()

	live := []int{}
	for pid := range t.tracked {
		if pid == t.rootPID {
			delete(t.tracked, pid)
			continue
		}
		if !processExists(pid) {
			delete(t.tracked, pid)
			continue
		}
		live = append(live, pid)
	}

	sort.Ints(live)
	return live
}

func (t *processTreeTracker) refresh() error {
	if t == nil || t.monitor == nil {
		return nil
	}

	return t.monitor.refreshTracker(t)
}

func (t *processTreeTracker) applySnapshot(childrenByParent map[int][]int) {
	descendants := collectDescendantPIDs(childrenByParent, t.rootPID)
	for _, pid := range collectPlatformContainmentRootPIDs(childrenByParent, t.serviceToken) {
		descendants = append(descendants, pid)
		descendants = append(descendants, collectDescendantPIDs(childrenByParent, pid)...)
	}

	t.mu.Lock()
	for _, pid := range descendants {
		t.tracked[pid] = struct{}{}
	}
	t.mu.Unlock()
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
