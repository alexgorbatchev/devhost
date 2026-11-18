package services

import (
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"
)

// fakeProcess is a process a test lists in a snapshot. These tests read the tracker's state and never signal what it
// tracks, because the PIDs they list may belong to real processes.
type fakeProcess struct {
	pid       int
	parentPID int
	identity  string
	exited    bool
}

func fakeSnapshot(processes ...fakeProcess) processSnapshot {
	snapshot := newProcessSnapshot()
	for _, process := range processes {
		snapshot.add(process.pid, processRecord{parentPID: process.parentPID, startIdentity: process.identity, exited: process.exited})
	}
	return snapshot
}

// replaySnapshots returns a reader that returns the snapshots in order and then keeps returning the last one.
func replaySnapshots(snapshots ...processSnapshot) processSnapshotReader {
	var mu sync.Mutex
	next := 0
	return func() (processSnapshot, error) {
		mu.Lock()
		defer mu.Unlock()

		snapshot := snapshots[next]
		if next < len(snapshots)-1 {
			next++
		}
		return snapshot, nil
	}
}

// startReplayTracker starts a tracker for rootPID that reads the first snapshot when it starts and each later one on
// a refresh. Its monitor never refreshes on its own.
func startReplayTracker(t *testing.T, rootPID int, snapshots ...processSnapshot) *processTreeTracker {
	t.Helper()

	monitor := newProcessTreeMonitor(time.Hour, replaySnapshots(snapshots...))
	t.Cleanup(monitor.close)

	tracker, err := monitor.startTracker(rootPID, "")
	if err != nil {
		t.Fatalf("monitor.startTracker(%d) error = %v", rootPID, err)
	}
	return tracker
}

func TestProcessTreeMonitorRefreshTrackersUsesSingleSnapshot(t *testing.T) {
	roots := []fakeProcess{{pid: 10, parentPID: 1, identity: "root 10"}, {pid: 20, parentPID: 1, identity: "root 20"}}
	snapshotCalls := 0
	monitor := newProcessTreeMonitor(time.Hour, func() (processSnapshot, error) {
		snapshotCalls++
		if snapshotCalls < 3 {
			return fakeSnapshot(roots...), nil
		}

		return fakeSnapshot(append(roots,
			fakeProcess{pid: 11, parentPID: 10, identity: "child 11"},
			fakeProcess{pid: 21, parentPID: 20, identity: "child 21"},
		)...), nil
	})
	t.Cleanup(monitor.close)

	trackerOne, err := monitor.startTracker(10, "")
	if err != nil {
		t.Fatalf("monitor.startTracker(10) error = %v", err)
	}
	trackerTwo, err := monitor.startTracker(20, "")
	if err != nil {
		t.Fatalf("monitor.startTracker(20) error = %v", err)
	}

	if err := monitor.refreshTrackers(); err != nil {
		t.Fatalf("monitor.refreshTrackers() error = %v", err)
	}

	if snapshotCalls != 3 {
		t.Fatalf("snapshotCalls = %d, want 3", snapshotCalls)
	}
	if got := slices.Sorted(maps.Keys(trackerOne.trackedProcesses())); !reflect.DeepEqual(got, []int{11}) {
		t.Fatalf("PIDs tracked for root 10 = %v, want [11]", got)
	}
	if got := slices.Sorted(maps.Keys(trackerTwo.trackedProcesses())); !reflect.DeepEqual(got, []int{21}) {
		t.Fatalf("PIDs tracked for root 20 = %v, want [21]", got)
	}
}

func TestProcessTreeMonitorRefreshTrackerReturnsSnapshotError(t *testing.T) {
	want := errors.New("boom")
	monitor := newProcessTreeMonitor(time.Hour, func() (processSnapshot, error) {
		return processSnapshot{}, want
	})
	t.Cleanup(monitor.close)

	if _, err := monitor.startTracker(10, ""); !errors.Is(err, want) {
		t.Fatalf("monitor.startTracker(10) error = %v, want %v", err, want)
	}
}

// The system gives a PID to a new process once the process that had it exits and is collected. The tracker tells the
// two apart by start identity, so it follows the service's processes and never a later holder of one of their PIDs.
func TestProcessTreeTrackerFollowsEachProcessByStartIdentity(t *testing.T) {
	root := fakeProcess{pid: 10, parentPID: 1, identity: "root"}
	tests := []struct {
		name string
		// snapshots are read in order: the first when the tracker starts, each later one on a refresh.
		snapshots []processSnapshot
		want      map[int]string
	}{
		{
			name: "tracks each descendant with the identity it has",
			snapshots: []processSnapshot{
				fakeSnapshot(root),
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}, fakeProcess{pid: 12, parentPID: 11, identity: "grandchild"}),
			},
			want: map[int]string{11: "child", 12: "grandchild"},
		},
		{
			name: "keeps a daemon that init or launchd adopted when its parent exited",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "launcher"}, fakeProcess{pid: 12, parentPID: 11, identity: "daemon"}),
				fakeSnapshot(root, fakeProcess{pid: 12, parentPID: 1, identity: "daemon"}),
			},
			want: map[int]string{12: "daemon"},
		},
		{
			name: "keeps the descendants of a root that has exited",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}),
				fakeSnapshot(fakeProcess{pid: 11, parentPID: 1, identity: "child"}),
			},
			want: map[int]string{11: "child"},
		},
		{
			name: "drops a descendant that has exited",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}),
				fakeSnapshot(root),
			},
			want: map[int]string{},
		},
		{
			name: "drops a descendant that waits to be collected",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}),
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child", exited: true}),
			},
			want: map[int]string{},
		},
		{
			name: "drops a PID that an unrelated later process has",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}),
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 1, identity: "unrelated"}),
			},
			want: map[int]string{},
		},
		{
			name: "tracks a later descendant that has a tracked PID under its own identity",
			snapshots: []processSnapshot{
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "child"}),
				fakeSnapshot(root, fakeProcess{pid: 11, parentPID: 10, identity: "later child"}),
			},
			want: map[int]string{11: "later child"},
		},
		{
			name: "adopts nothing under the root's PID once a later process has it",
			snapshots: []processSnapshot{
				fakeSnapshot(root),
				fakeSnapshot(fakeProcess{pid: 10, parentPID: 1, identity: "unrelated"}, fakeProcess{pid: 11, parentPID: 10, identity: "unrelated child"}),
			},
			want: map[int]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tracker := startReplayTracker(t, root.pid, tt.snapshots...)
			for range tt.snapshots[1:] {
				if err := tracker.refresh(); err != nil {
					t.Fatalf("tracker.refresh() error = %v", err)
				}
			}

			if got := tracker.trackedProcesses(); !maps.Equal(got, tt.want) {
				t.Fatalf("tracked processes = %v, want %v", got, tt.want)
			}
		})
	}
}

// A service that starts a short-lived child for each job shows the tracker a new PID in nearly every snapshot. The
// tracker holds only the children that still run, however many have come and gone.
func TestProcessTreeTrackerHoldsOnlyRunningChildren(t *testing.T) {
	root := fakeProcess{pid: 10, parentPID: 1, identity: "root"}
	const jobs = 100
	snapshots := []processSnapshot{fakeSnapshot(root)}
	for job := range jobs {
		snapshots = append(snapshots, fakeSnapshot(root, fakeProcess{pid: 1000 + job, parentPID: 10, identity: fmt.Sprintf("job %d", job)}))
	}

	tracker := startReplayTracker(t, root.pid, snapshots...)
	for job := range jobs {
		if err := tracker.refresh(); err != nil {
			t.Fatalf("tracker.refresh() error = %v", err)
		}

		want := map[int]string{1000 + job: fmt.Sprintf("job %d", job)}
		if got := tracker.trackedProcesses(); !maps.Equal(got, want) {
			t.Fatalf("after job %d, tracked processes = %v, want %v", job, got, want)
		}
	}
}
