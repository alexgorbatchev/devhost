package services

import (
	"errors"
	"reflect"
	"slices"
	"testing"
	"time"
)

func TestProcessTreeMonitorRefreshTrackersUsesSingleSnapshot(t *testing.T) {
	snapshotCalls := 0
	monitor := newProcessTreeMonitor(time.Hour, func() (map[int][]int, error) {
		snapshotCalls++
		if snapshotCalls < 3 {
			return map[int][]int{}, nil
		}

		return map[int][]int{
			10: {11},
			20: {21},
		}, nil
	})
	t.Cleanup(monitor.close)

	trackerOne, error := monitor.startTracker(10, "")
	if error != nil {
		t.Fatalf("monitor.startTracker(10) error = %v", error)
	}
	trackerTwo, error := monitor.startTracker(20, "")
	if error != nil {
		t.Fatalf("monitor.startTracker(20) error = %v", error)
	}

	if error := monitor.refreshTrackers(); error != nil {
		t.Fatalf("monitor.refreshTrackers() error = %v", error)
	}

	if snapshotCalls != 3 {
		t.Fatalf("snapshotCalls = %d, want 3", snapshotCalls)
	}
	if got := trackedDescendantPIDs(trackerOne); !reflect.DeepEqual(got, []int{11}) {
		t.Fatalf("trackedDescendantPIDs(trackerOne) = %v, want [11]", got)
	}
	if got := trackedDescendantPIDs(trackerTwo); !reflect.DeepEqual(got, []int{21}) {
		t.Fatalf("trackedDescendantPIDs(trackerTwo) = %v, want [21]", got)
	}
}

func TestProcessTreeMonitorRefreshTrackerReturnsSnapshotError(t *testing.T) {
	want := errors.New("boom")
	monitor := newProcessTreeMonitor(time.Hour, func() (map[int][]int, error) {
		return nil, want
	})
	t.Cleanup(monitor.close)

	if _, error := monitor.startTracker(10, ""); !errors.Is(error, want) {
		t.Fatalf("monitor.startTracker(10) error = %v, want %v", error, want)
	}
}

func trackedDescendantPIDs(tracker *processTreeTracker) []int {
	tracker.mu.Lock()
	defer tracker.mu.Unlock()

	descendants := make([]int, 0, len(tracker.tracked))
	for pid := range tracker.tracked {
		descendants = append(descendants, pid)
	}
	slices.Sort(descendants)
	return descendants
}
